// Regresión de "orientación del escenario" para el sol: en modo ciclo/hora real el acimut lo marca
// el reloj (no un slider directo, a diferencia del modo manual), así que no había forma de elegir por
// qué lado del escenario CONSTRUIDO amanece/anochece sin rotar cada objeto a mano. Se añadió
// sceneEnvironment.sunOrientationOffsetDeg, sumado al acimut calculado dentro de updateSunCycle().
// Esta prueba extrae y ejecuta el updateSunCycle() REAL de index.html (no una reimplementación
// aparte) con un dirLight/documento simulados, y comprueba que el desfase realmente gira la posición
// del sol el ángulo esperado -- misma altura, acimut desplazado -- sin tocar nada más (color,
// intensidad, velo nocturno).
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
function assert(cond, msg) { if (cond) ok(msg); else fail(msg); }

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
  "function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }",
  "function deg2rad(d){ return (d*Math.PI)/180; }",
  extractFn(liveSrc, "sunPositionFromAngles"),
  extractFn(liveSrc, "sunAnglesFromHour"),
  extractFn(liveSrc, "sunAnglesFromRealDateTime"),
  extractFn(liveSrc, "computeSunHourOfDay"),
  extractFn(liveSrc, "nightTintFactorFromElevation"),
  extractFn(liveSrc, "lerpColorHex"),
  extractFn(liveSrc, "applyNightTint"),
  extractFn(liveSrc, "updateSunCycle"),
  "module.exports = { updateSunCycle, sunPositionFromAngles };",
].join("\n\n");
const buildersFile = path.join(TMP, "sun-orientation.cjs");
fs.writeFileSync(buildersFile, cuerpo);
const { updateSunCycle } = require(buildersFile);

// Entorno mínimo simulado (dirLight/documento) -- solo lo que updateSunCycle() de verdad toca.
function nuevoEntornoDePrueba(sunOrientationOffsetDeg) {
  const posiciones = [];
  global.dirLight = {
    color: { set() {} },
    intensity: 0,
    position: { set(x, y, z) { posiciones.push([x, y, z]); } },
  };
  global.document = { getElementById: () => ({ style: {} }) };
  global.THREE = { Color: function (v) { this.v = v; } };
  global.scene = { background: null, fog: { color: { set() {} } } };
  global.sceneEnvironment = {
    sunMode: "cycle", sunColor: "#ffffff", sunIntensity: 1.4,
    dayDurationMin: 10, sunOrientationOffsetDeg,
    bgColor: "#0a0b0f", nightBgColor: "#050912", horizonBase64: null,
  };
  global.dayCycleClock = 0;
  global.dayCycleTotalSec = 0; // computeSunHourOfDay() también lo acumula (lo usa simulatedSkyDate()) -- si no se declara aquí, "+=" revienta con ReferenceError al leerlo sin inicializar
  return posiciones;
}

// Mediodía del ciclo (elevación máxima, ~24° de acimut base según sunAnglesFromHour a esa hora) --
// con desfase 0 vs. desfase 90, la posición del sol debe rotar 90° alrededor del eje Y manteniendo
// la misma altura (mismo radio en el plano XZ, mismo Y), no cambiar de ninguna otra forma.
const DT_MEDIODIA = 10 * 60 * 0.5; // medio ciclo de 10 min -> hora ~12 del "reloj" del ciclo

const posSinOffset = nuevoEntornoDePrueba(0);
updateSunCycle(DT_MEDIODIA);
const [x0, y0, z0] = posSinOffset[0];

const posConOffset = nuevoEntornoDePrueba(90);
updateSunCycle(DT_MEDIODIA);
const [x90, y90, z90] = posConOffset[0];

const radio0 = Math.hypot(x0, z0), radio90 = Math.hypot(x90, z90);
assert(Math.abs(radio0 - radio90) < 1e-6, "El desfase de orientación no cambia la altura del sol (mismo radio en el plano XZ): " + radio0 + " vs " + radio90);
assert(Math.abs(y0 - y90) < 1e-6, "El desfase de orientación no cambia la altura (Y) del sol: " + y0 + " vs " + y90);

// Ángulo entre las dos posiciones (proyectadas en XZ) medido con atan2 -- debe ser 90° (con margen
// por redondeo), confirmando que el desfase realmente gira el acimut y no otra cosa.
const angulo0 = Math.atan2(x0, z0), angulo90 = Math.atan2(x90, z90);
let diffDeg = ((angulo90 - angulo0) * 180) / Math.PI;
diffDeg = ((diffDeg % 360) + 360) % 360;
assert(Math.abs(diffDeg - 90) < 0.5, "El sol debe rotar exactamente 90° con sunOrientationOffsetDeg=90 (obtenido " + diffDeg.toFixed(2) + "°)");

// Control: un desfase de 360° (una vuelta completa) equivale a no aplicar ninguno -- confirma el
// "% 360" y que no hay desbordes raros en los bordes del rango.
const posVueltaCompleta = nuevoEntornoDePrueba(360);
updateSunCycle(DT_MEDIODIA);
const [x360, y360, z360] = posVueltaCompleta[0];
assert(Math.abs(x360 - x0) < 1e-6 && Math.abs(y360 - y0) < 1e-6 && Math.abs(z360 - z0) < 1e-6, "Un desfase de 360° da la misma posición que 0° (una vuelta completa)");

process.exit(hadFailure ? 1 : 0);
