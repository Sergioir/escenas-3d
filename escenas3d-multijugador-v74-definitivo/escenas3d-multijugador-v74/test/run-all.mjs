// Orquestador: ejecuta todas las pruebas y resume el resultado. Uso: npm test (o node run-all.mjs)
// dentro de test/, tras "npm install" una vez.
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const suites = [
  ["Sintaxis (editor + juego exportado real) y paridad de funciones críticas", "syntax-and-parity.mjs"],
  ["Comportamiento del motor (disparo, panel interactivo, fundido/fantasma)", "engine-functional.mjs"],
  ["Escala/suelo de modelos GLTF con esqueleto (regresión CesiumMan)", "gltf-scale-regression.mjs"],
  ["Sintaxis de los .php del multijugador (PHP real via WASM)", "php-lint.mjs"],
];

let allOk = true;
for (const [label, file] of suites) {
  console.log("\n=== " + label + " ===");
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
  if (r.status !== 0) allOk = false;
}

console.log("\n" + (allOk ? "TODO OK ✔" : "HAY FALLOS ✘"));
process.exit(allOk ? 0 : 1);
