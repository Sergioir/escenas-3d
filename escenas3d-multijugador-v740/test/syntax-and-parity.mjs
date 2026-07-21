// Comprueba: (1) el módulo del editor en vivo tiene sintaxis válida, (2) el generador de export
// (buildStandaloneGameRuntimeSrc/buildStandaloneGameHtml) produce un juego exportado con sintaxis
// válida usando el código REAL de index.html (no una copia aparte), (3) las funciones de motor
// consideradas críticas (física, disparo, interactivo, bóveda nocturna, meteoros, grillo, gltf...)
// existen con el MISMO NOMBRE en ambas copias -- el patrón de bug que más veces rompió esta app fue
// una inserción o función que solo llegó a una de las dos copias del motor.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
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

// ---- 1. Extraer y comprobar el <script type="module"> del editor en vivo ----
const liveMatch = html.match(/<script type="module">([\s\S]*)<\/script>\s*<\/body>/);
if (!liveMatch) { console.error("No se encontró el <script type=\"module\"> del editor."); process.exit(1); }
const liveSrc = liveMatch[1];
const liveFile = path.join(TMP, "live-module.mjs");
fs.writeFileSync(liveFile, liveSrc);
try {
  execSync(`node --check "${liveFile}"`, { stdio: "pipe" });
  ok("Sintaxis del editor en vivo (index.html).");
} catch (e) {
  fail("Sintaxis del editor en vivo:\n" + e.stderr.toString());
}

// ---- 2. Generar el export REAL ejecutando el código de index.html y comprobar su sintaxis ----
function extractFn(src, name) {
  const idx = src.indexOf("function " + name);
  if (idx === -1) throw new Error("No se encontró function " + name + " en el editor en vivo.");
  const start = src.indexOf("{", idx);
  let depth = 0, i = start;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(idx, i + 1);
}

const fn1 = extractFn(liveSrc, "buildStandaloneGameRuntimeSrc");
const fn2 = extractFn(liveSrc, "buildStandaloneGameHtml");
const buildersFile = path.join(TMP, "builders.cjs");
fs.writeFileSync(buildersFile, fn1 + "\n" + fn2 + "\nmodule.exports = { buildStandaloneGameRuntimeSrc, buildStandaloneGameHtml };");
const builders = require(buildersFile);

const testProject = {
  objects: [],
  camera: { position: { x: 0, y: 1.6, z: 5 }, target: { x: 0, y: 1.6, z: 0 } },
  audio: {},
  environment: {
    nightSkyEnabled: false, skyDateMode: "auto", skyManualDate: "", skyManualTime: "",
    skyLongitudeDeg: -3.7, skyUtcOffsetHours: 1, moonTextureBase64: null, moonTextureFileName: null,
    nightBgColor: "#050912",
  },
  groups: [],
};

const exportedHtml = builders.buildStandaloneGameHtml(testProject);
fs.writeFileSync(path.join(TMP, "export.html"), exportedHtml);

const scriptMatch = exportedHtml.match(/<script type="module">([\s\S]*?)<\/script>\s*<\/body>/);
if (!scriptMatch) { console.error("El HTML exportado no contiene el <script type=\"module\"> esperado."); process.exit(1); }
const exportScriptSrc = scriptMatch[1];
const exportFile = path.join(TMP, "export-script.mjs");
fs.writeFileSync(exportFile, exportScriptSrc);
try {
  execSync(`node --check "${exportFile}"`, { stdio: "pipe" });
  ok("Sintaxis del juego exportado (generado en caliente desde el código real de index.html).");
} catch (e) {
  fail("Sintaxis del juego exportado:\n" + e.stderr.toString());
}

// ---- 3. Paridad de funciones críticas del motor ----
const criticalList = JSON.parse(fs.readFileSync(path.join(__dirname, "critical-runtime-functions.json"), "utf-8"));
const missingCritical = criticalList.filter((name) => !(exportScriptSrc.includes("function " + name + "(") || exportScriptSrc.includes("function " + name + " (")));

if (missingCritical.length) {
  fail("Funciones CRÍTICAS del motor ausentes del juego exportado:\n  - " + missingCritical.join("\n  - "));
} else {
  ok(`Paridad de ${criticalList.length} funciones críticas del motor (editor en vivo <-> juego exportado).`);
}

// Informe adicional (no bloqueante): resto de funciones del editor no presentes literalmente en el
// export, para revisión manual ocasional -- la mayoría son UI de autoría (paneles, gizmos, undo,
// portapapeles, multijugador) que deliberadamente no forman parte del juego jugable exportado.
const liveFnNames = Array.from(liveSrc.matchAll(/^function\s+([a-zA-Z_$][\w$]*)\s*\(/gm)).map((m) => m[1]);
const otherMissing = liveFnNames.filter((n) => !criticalList.includes(n) && !(exportScriptSrc.includes("function " + n + "(") || exportScriptSrc.includes("function " + n + " (")));
console.log(`\n(info, no bloqueante) ${otherMissing.length} funciones del editor no aparecen literalmente en el export -- se asume que son de autoría/edición (paneles, gizmos, undo, portapapeles, multijugador, node/path editors...). Revisar de vez en cuando: test/.tmp/live-module.mjs y test/.tmp/export-script.mjs quedan generados para inspección manual si hace falta.`);

process.exit(hadFailure ? 1 : 0);
