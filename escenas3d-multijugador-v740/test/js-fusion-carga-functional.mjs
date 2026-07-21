// Prueba funcional de fusionarProyectosJS() -- la fusión que usa "Cargar cambios" en el navegador
// para NO perder ediciones locales sin guardar cuando llega la versión de otra persona (antes de
// esto, aplicarActualizacionSala() sobrescribía la escena local sin más, y era ahí donde de verdad se
// perdía el trabajo -- el guardado sí fusionaba, pero la CARGA no). Se extrae y ejecuta la función
// REAL de index.html (no una reimplementación aparte), y se repiten los mismos 5 escenarios que
// test/php-fusion-guardados-functional.mjs para comprobar que el navegador y el servidor razonan
// exactamente igual ante los mismos datos -- si algún día divergen, esto lo detecta.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const INDEX_HTML = path.resolve(__dirname, "..", "index.html");
const TMP = path.join(__dirname, ".tmp");
fs.mkdirSync(TMP, { recursive: true });

let hadFailure = false;
function fail(msg) { console.error("FALLO: " + msg); hadFailure = true; }
function ok(msg) { console.log("OK: " + msg); }

const html = fs.readFileSync(INDEX_HTML, "utf-8");
const liveMatch = html.match(/<script type="module">([\s\S]*)<\/script>\s*<\/body>/);
const liveSrc = liveMatch[1];

function extractFn(src, name) {
  const idx = src.indexOf("function " + name);
  if (idx === -1) throw new Error("No se encontró function " + name);
  const start = src.indexOf("{", idx);
  let depth = 0, i = start;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(idx, i + 1);
}

const cuerpo = [
  extractFn(liveSrc, "huellaObjetoJS"),
  extractFn(liveSrc, "indexarObjetosPorIdJS"),
  extractFn(liveSrc, "fusionarProyectosJS"),
  "module.exports = { fusionarProyectosJS };",
].join("\n\n");
const buildersFile = path.join(TMP, "fusion-js.cjs");
fs.writeFileSync(buildersFile, cuerpo);
const { fusionarProyectosJS } = require(buildersFile);

function obj(id, extra) { return { id, kind: "primitive", colorHex: "#ff0000", transform: { position: [0, 0, 0] }, ...extra }; }
function proyecto(objects, extra) { return { don_claude_3d_project: true, version: 1, objects, environment: {}, audio: {}, camera: {}, ...extra }; }
function idsDe(p) { return p.objects.map((o) => o.id).sort(); }

// ── 1) Dos altas simultáneas -- la del navegador que carga NO debe perderse ──────────────────────
{
  const base = proyecto([obj("a")]);
  const local = proyecto([obj("a"), obj("b")]);      // esta pestaña añadió "b", aún sin guardar
  const servidor = proyecto([obj("a"), obj("c")]);    // otra persona ya guardó "c"
  const { proyecto: r } = fusionarProyectosJS(base, local, servidor);
  if (JSON.stringify(idsDe(r)) === JSON.stringify(["a", "b", "c"])) ok('Al cargar, "b" (local, sin guardar) sobrevive junto a "c" (ajeno) -- antes se perdía "b"');
  else fail("Se esperaba [a,b,c], se obtuvo " + JSON.stringify(idsDe(r)));
}

// ── 2) Edición local sin guardar sobre un objeto que el otro lado no tocó ─────────────────────────
{
  const base = proyecto([obj("a", { colorHex: "#ff0000" })]);
  const local = proyecto([obj("a", { colorHex: "#00ff00" })]); // esta pestaña recoloreó "a"
  const servidor = proyecto([obj("a", { colorHex: "#ff0000" })]); // el servidor sigue como la base
  const { proyecto: r } = fusionarProyectosJS(base, local, servidor);
  const a = r.objects.find((o) => o.id === "a");
  if (a.colorHex === "#00ff00") ok('Edición local sin guardar de "a" se conserva al cargar (nadie más lo tocó)');
  else fail('Se esperaba #00ff00, se obtuvo ' + a.colorHex);
}

// ── 3) Conflicto real: el mismo objeto editado en los dos sitios a la vez ────────────────────────
{
  const base = proyecto([obj("a", { colorHex: "#ff0000" })]);
  const local = proyecto([obj("a", { colorHex: "#0000ff" })]);    // esta pestaña: azul
  const servidor = proyecto([obj("a", { colorHex: "#00ff00" })]); // otra persona ya guardó verde
  const { proyecto: r, conflictos } = fusionarProyectosJS(base, local, servidor);
  const a = r.objects.find((o) => o.id === "a");
  if (a.colorHex === "#00ff00" && conflictos.includes("a")) ok('Conflicto real sobre "a" al cargar: se mantiene lo ya guardado (verde) y se avisa');
  else fail("Se esperaba #00ff00 y conflictos=[a], se obtuvo " + JSON.stringify({ a, conflictos }));
}

// ── 4) Edición local sin guardar sobre un objeto que la otra persona borró ────────────────────────
{
  const base = proyecto([obj("a"), obj("d", { colorHex: "#ff0000" })]);
  const local = proyecto([obj("a"), obj("d", { colorHex: "#ffff00" })]); // esta pestaña editó "d"
  const servidor = proyecto([obj("a")]);                                  // otra persona borró "d"
  const { proyecto: r, conflictos } = fusionarProyectosJS(base, local, servidor);
  const d = r.objects.find((o) => o.id === "d");
  if (d && d.colorHex === "#ffff00" && conflictos.includes("d")) ok('Edición local de "d" sobrevive aunque otra persona lo borrara -- se avisa');
  else fail('Se esperaba d con #ffff00 (no borrado), se obtuvo ' + JSON.stringify({ d, conflictos }));
}

// ── 5) Control: sin ediciones locales de por medio, cargar refleja fielmente lo del servidor ──────
{
  const base = proyecto([obj("a"), obj("e")]);
  const local = proyecto([obj("a")]); // esta pestaña ya no tiene "e" tampoco (no lo tocó desde base)
  const servidor = proyecto([obj("a")]);
  const { proyecto: r } = fusionarProyectosJS(base, local, servidor);
  if (JSON.stringify(idsDe(r)) === JSON.stringify(["a"])) ok('Sin ediciones locales de por medio, cargar refleja fielmente el servidor');
  else fail("Se esperaba [a], se obtuvo " + JSON.stringify(idsDe(r)));
}

process.exit(hadFailure ? 1 : 0);
