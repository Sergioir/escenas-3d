// Prueba funcional del guardado cooperativo de multi/proyecto.php: cuando dos personas editan la
// misma sala a la vez, un guardado NO debe hacer perder lo que la otra persona acaba de guardar.
// Cubre los 4 escenarios reales que motivaron esta función (ver docblock de proyecto.php):
//   1) Dos altas simultáneas de objetos distintos -> ambas sobreviven (nadie pierde lo que añadió).
//   2) Edición de un objeto que el otro lado no tocó -> gana la edición (no hay nada que defender).
//   3) Conflicto real: el MISMO objeto editado por los dos desde la misma base -> gana lo ya
//      guardado, y se avisa en "conflictos" (no se pierde en silencio ni se pisa en silencio).
//   4) Borrado de un objeto que, mientras tanto, otra persona editó -> se conserva la edición ajena
//      (no se deja que un borrado "a ciegas" tire una edición reciente), también avisado.
// Ejecuta el fichero PHP REAL con un intérprete real (WebAssembly), simulando peticiones HTTP.
import { PHP } from "@php-wasm/universal";
import { loadNodeRuntime } from "@php-wasm/node";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROYECTO_PHP = path.resolve(__dirname, "..", "multi", "proyecto.php");

let hadFailure = false;
function fail(msg) { console.error("FALLO: " + msg); hadFailure = true; }
function ok(msg) { console.log("OK: " + msg); }

const php = new PHP(await loadNodeRuntime("8.1", { emscriptenOptions: { processId: process.pid } }));
php.mkdir("/www");
php.writeFile("/www/proyecto.php", fs.readFileSync(PROYECTO_PHP, "utf-8"));

async function guardar(sala, proyecto, proyectoBaseLigero) {
  const out = await php.run({
    scriptPath: "/www/proyecto.php",
    relativeUri: "/proyecto.php?sala=" + encodeURIComponent(sala),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify({ sala, proyecto, proyectoBaseLigero })),
  });
  return { status: out.httpStatusCode, json: JSON.parse(out.text || "{}") };
}

function obj(id, extra) { return { id, kind: "primitive", colorHex: "#ff0000", transform: { position: [0, 0, 0] }, ...extra }; }
function proyecto(objects, extra) { return { don_claude_3d_project: true, version: 1, objects, environment: {}, audio: {}, camera: {}, ...extra }; }
function idsDe(p) { return p.objects.map((o) => o.id).sort(); }

// ── Escenario 1: dos altas simultáneas de objetos distintos ──────────────────────────────────────
{
  const sala = "salaAltas";
  const base = proyecto([obj("a")]);
  // Editor 1 guarda primero: parte de "base", añade "b".
  const r1 = await guardar(sala, proyecto([obj("a"), obj("b")]), base);
  // Editor 2 (sin saber nada de "b") parte de la MISMA "base" y añade "c".
  const r2 = await guardar(sala, proyecto([obj("a"), obj("c")]), base);
  const finalIds = idsDe(r2.json.proyecto);
  if (r1.status === 200 && r2.status === 200 && JSON.stringify(finalIds) === JSON.stringify(["a", "b", "c"])) {
    ok("Dos altas simultáneas (b y c) sobreviven ambas -- nadie pierde lo que añadió");
  } else {
    fail("Se esperaba [a,b,c], se obtuvo " + JSON.stringify(finalIds));
  }
}

// ── Escenario 2: edición que el otro lado no tocó ─────────────────────────────────────────────────
{
  const sala = "salaEdicionLimpia";
  const base = proyecto([obj("a", { colorHex: "#ff0000" }), obj("b")]);
  await guardar(sala, base, null); // primer guardado, fija el estado inicial en el servidor
  // Editor 1 recolorea "a" (partiendo de "base") y guarda.
  const r1 = await guardar(sala, proyecto([obj("a", { colorHex: "#00ff00" }), obj("b")]), base);
  // Editor 2, que nunca tocó "a", guarda después (con su propia base = la original, sin saber del cambio).
  const r2 = await guardar(sala, proyecto([obj("a", { colorHex: "#ff0000" }), obj("b")]), base);
  const aFinal = r2.json.proyecto.objects.find((o) => o.id === "a");
  if (r2.status === 200 && aFinal.colorHex === "#00ff00") {
    ok('Edición ajena a "a" se conserva cuando el otro lado no la tocó');
  } else {
    fail('Se esperaba colorHex #00ff00 en "a", se obtuvo ' + JSON.stringify(aFinal));
  }
}

// ── Escenario 3: conflicto real -- el MISMO objeto editado por los dos ───────────────────────────
{
  const sala = "salaConflicto";
  const base = proyecto([obj("a", { colorHex: "#ff0000" })]);
  await guardar(sala, base, null);
  const r1 = await guardar(sala, proyecto([obj("a", { colorHex: "#00ff00" })]), base); // editor 1: verde
  const r2 = await guardar(sala, proyecto([obj("a", { colorHex: "#0000ff" })]), base); // editor 2: azul, mismo punto de partida
  const aFinal = r2.json.proyecto.objects.find((o) => o.id === "a");
  if (r2.status === 200 && aFinal.colorHex === "#00ff00" && r2.json.conflictos.includes("a")) {
    ok('Conflicto real sobre "a": gana lo ya guardado (verde) y se avisa en conflictos');
  } else {
    fail("Se esperaba colorHex #00ff00 y conflictos=[a], se obtuvo " + JSON.stringify({ a: aFinal, conflictos: r2.json.conflictos }));
  }
}

// ── Escenario 4: borrado a ciegas de un objeto que otra persona acaba de editar ───────────────────
{
  const sala = "salaBorradoVsEdicion";
  const base = proyecto([obj("a"), obj("d", { colorHex: "#ff0000" })]);
  await guardar(sala, base, null);
  const r1 = await guardar(sala, proyecto([obj("a"), obj("d", { colorHex: "#ffff00" })]), base); // editor 1 edita "d"
  const r2 = await guardar(sala, proyecto([obj("a")]), base); // editor 2, sin saberlo, borra "d"
  const dFinal = r2.json.proyecto.objects.find((o) => o.id === "d");
  if (r2.status === 200 && dFinal && dFinal.colorHex === "#ffff00" && r2.json.conflictos.includes("d")) {
    ok('Borrado a ciegas de "d" no destruye la edición ajena reciente -- se conserva y se avisa');
  } else {
    fail("Se esperaba d con colorHex #ffff00 (no borrado) y conflictos incluyendo d, se obtuvo " + JSON.stringify({ d: dFinal, conflictos: r2.json.conflictos }));
  }
}

// ── Escenario 5 (control): borrado limpio, sin que nadie más lo tocara -- SÍ debe desaparecer ─────
{
  const sala = "salaBorradoLimpio";
  const base = proyecto([obj("a"), obj("e")]);
  await guardar(sala, base, null);
  const r = await guardar(sala, proyecto([obj("a")]), base); // borro "e", nadie más lo tocó
  const eFinal = r.json.proyecto.objects.find((o) => o.id === "e");
  if (r.status === 200 && !eFinal) {
    ok('Borrado limpio de "e" (nadie más lo tocó) SÍ se aplica -- no queda "fantasma"');
  } else {
    fail("Se esperaba que e desapareciera, se obtuvo " + JSON.stringify(eFinal));
  }
}

process.exit(hadFailure ? 1 : 0);
