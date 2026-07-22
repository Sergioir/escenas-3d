// Prueba funcional del campo "version" (filemtime) que expone multi/proyecto.php en las respuestas
// de comprobarPin (GET) y de guardado (POST) -- es lo que permite al editor sondear cada ~10s si
// alguien ha actualizado la sala, sin tener que descargar el proyecto entero en cada sondeo (ver
// "Sondeo periódico de cambios guardados en la sala" en index.html: iniciarSondeoSala/comprobarVersionSala).
// Ejecuta el fichero PHP REAL con un intérprete real (WebAssembly), simulando peticiones HTTP completas.
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

async function comprobarPin(sala) {
  const out = await php.run({ scriptPath: "/www/proyecto.php", relativeUri: "/proyecto.php?sala=" + encodeURIComponent(sala) + "&comprobarPin=1", method: "GET" });
  return { status: out.httpStatusCode, json: JSON.parse(out.text || "{}") };
}

async function guardar(sala, proyecto) {
  const out = await php.run({
    scriptPath: "/www/proyecto.php",
    relativeUri: "/proyecto.php?sala=" + encodeURIComponent(sala),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify({ sala, proyecto })),
  });
  return { status: out.httpStatusCode, json: JSON.parse(out.text || "{}") };
}

// 1) Sala que nunca se ha guardado: version debe venir a null (nada que sondear todavía).
{
  const r = await comprobarPin("salaNueva");
  if (r.status === 200 && r.json.ok === true && r.json.version === null) ok("Sala sin proyecto guardado -> version:null");
  else fail("Sala sin proyecto guardado debería dar version:null (obtenido " + JSON.stringify(r.json) + ")");
}

// 2) Primer guardado: la respuesta del POST debe traer ya una "version" (entero, filemtime).
const proyectoMinimo = { don_claude_3d_project: true, objects: [] };
let v1;
{
  const r = await guardar("salaSondeo", proyectoMinimo);
  v1 = r.json.version;
  if (r.status === 200 && r.json.ok === true && Number.isInteger(v1)) ok("Primer guardado devuelve version (entero) en la respuesta del POST");
  else fail("Primer guardado debería devolver version entero (obtenido " + JSON.stringify(r.json) + ")");
}

// 3) comprobarPin sobre esa misma sala debe devolver la MISMA version que acaba de dar el guardado
//    (así el cliente que acaba de guardar no se auto-notifica como si fuera un cambio ajeno).
{
  const r = await comprobarPin("salaSondeo");
  if (r.status === 200 && r.json.version === v1) ok("comprobarPin tras guardar devuelve la misma version que el POST");
  else fail("comprobarPin debería coincidir con la version del POST (v1=" + v1 + ", obtenido " + JSON.stringify(r.json) + ")");
}

// 4) Un guardado posterior (p.ej. desde otro navegador, con un mtime más reciente en el fichero)
//    se refleja en la version que devuelve comprobarPin -- es justo lo que el sondeo del cliente
//    usa para detectar "hay cambios nuevos, no son los míos". Se fuerza el mtime a mano (en vez de
//    depender de dos escrituras reales seguidas) porque filemtime() tiene resolución de 1 segundo y
//    este test corre mucho más rápido que eso -- lo que de verdad importa aquí es que comprobarPin
//    lee y expone fielmente el filemtime real del fichero, no la resolución del reloj de prueba.
{
  await php.run({ code: `<?php touch('/www/data/proyectos/salaSondeo.json', ${v1} + 5); echo "ok";` });
  const r = await comprobarPin("salaSondeo");
  const v2 = r.json.version;
  if (r.status === 200 && v2 === v1 + 5) ok("Un mtime más reciente en el fichero se refleja en la version devuelta por comprobarPin");
  else fail("Debería reflejar v1+5=" + (v1 + 5) + " (obtenido " + JSON.stringify(r.json) + ")");
}

process.exit(hadFailure ? 1 : 0);
