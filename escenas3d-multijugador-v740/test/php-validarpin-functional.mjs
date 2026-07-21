// Prueba funcional (no solo sintaxis) de la acción validarPin de multi/proyecto.php -- usada por
// "Pulsar para editar": el editor completo de una sala compartida por enlace queda bloqueado (modo
// visitante) hasta que se introduce el PIN correcto. Ejecuta el fichero PHP REAL con un intérprete
// real (WebAssembly), simulando peticiones HTTP completas (método, query string, cuerpo JSON).
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

// PIN de prueba "1234" ya fijado a mano para la sala "salaProtegida" (evita depender del POST de
// guardado, que ya se prueba en la práctica real de la app -- aquí solo probamos validarPin).
await php.run({
  code: `<?php @mkdir('/www/data/proyectos/', 0777, true);
    file_put_contents('/www/data/proyectos/salaProtegida.pin', password_hash('1234', PASSWORD_DEFAULT));
    echo "ok";`,
});

async function call(sala, pin, metodo) {
  const out = await php.run({
    scriptPath: "/www/proyecto.php",
    relativeUri: "/proyecto.php?sala=" + encodeURIComponent(sala) + "&validarPin=1",
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify({ pin })),
  });
  return { status: out.httpStatusCode, json: JSON.parse(out.text || "{}") };
}

const casos = [
  { nombre: "PIN correcto en sala protegida -> 200 ok:true", sala: "salaProtegida", pin: "1234", metodo: "POST", esperado: { status: 200, ok: true } },
  { nombre: "PIN incorrecto en sala protegida -> 403", sala: "salaProtegida", pin: "0000", metodo: "POST", esperado: { status: 403, ok: false } },
  { nombre: "Sala sin proteger -> 200 ok:true (nada que desbloquear)", sala: "salaAbierta", pin: "loquesea", metodo: "POST", esperado: { status: 200, ok: true } },
  { nombre: "Método GET rechazado (el PIN solo viaja por POST)", sala: "salaProtegida", pin: "1234", metodo: "GET", esperado: { status: 405 } },
];

for (const c of casos) {
  const r = await call(c.sala, c.pin, c.metodo);
  const okStatus = r.status === c.esperado.status;
  const okFlag = c.esperado.ok === undefined || r.json.ok === c.esperado.ok;
  if (okStatus && okFlag) ok(c.nombre);
  else fail(c.nombre + ` (obtenido status=${r.status} json=${JSON.stringify(r.json)})`);
}

process.exit(hadFailure ? 1 : 0);
