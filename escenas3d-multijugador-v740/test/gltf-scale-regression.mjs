// Regresión del bug: un modelo con esqueleto (personaje rigged) cuya "bind pose" no es una postura de
// pie normal puede medir, en crudo, una fracción de su tamaño real (le pasó a CesiumMan.glb: 0,31 x
// 1,14 x 1,51 en reposo). El editor corrige esto con computeModelBounds() (recorre la animación y usa
// la posición real de los huesos, no la malla en reposo) para reescalar a ~1.6m y apoyar en el suelo.
// Esa función se portó también al juego exportado -- esta prueba construye un esqueleto sintético con
// una "pose de reposo" deliberadamente aplastada (para forzar el mismo caso raro) y comprueba que
// computeModelBounds(), tal cual vive HOY en index.html (extraída y ejecutada de verdad, no
// reimplementada), calcula un tamaño realista a partir de la animación en vez del bind pose.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import * as THREE from "three";

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

// Extraemos computeModelBounds tal cual está HOY en el editor (misma fuente de la que se portó al
// export -- si algún día divergen, el test de paridad de test/syntax-and-parity.mjs lo detecta aparte).
const fnSrc = extractFn(liveSrc, "computeModelBounds");
const runner = new Function("THREE", fnSrc + "\nreturn computeModelBounds;");
const computeModelBounds = runner(THREE);

// --- Construir un esqueleto sintético con bind pose "aplastada" y una animación que "se pone de pie" ---
const rootBone = new THREE.Bone(); rootBone.name = "RootBone"; rootBone.position.set(0, 0, 0);
const midBone = new THREE.Bone(); midBone.name = "MidBone"; midBone.position.set(0, 0.05, 0); // en bind pose casi no se separa (aplastado)
const tipBone = new THREE.Bone(); tipBone.name = "TipBone"; tipBone.position.set(0, 0.05, 0);
rootBone.add(midBone); midBone.add(tipBone);

const bones = [rootBone, midBone, tipBone];
const skeleton = new THREE.Skeleton(bones);
const geometry = new THREE.BoxGeometry(0.3, 0.1, 0.3, 1, 1, 1); // caja "aplastada", como una lámina
const skinIndices = [], skinWeights = [];
const posAttr = geometry.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
  skinIndices.push(0, 0, 0, 0);
  skinWeights.push(1, 0, 0, 0);
}
geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
const material = new THREE.MeshBasicMaterial();
const mesh = new THREE.SkinnedMesh(geometry, material);
mesh.add(rootBone);
mesh.bind(skeleton);

const inner = new THREE.Group();
inner.add(mesh);

// Animación: el hueso medio y la punta se "estiran" hacia arriba durante el clip -- simula una pose
// real de pie muy distinta de la bind pose aplastada, igual que le pasaba a CesiumMan.
const track = new THREE.VectorKeyframeTrack(
  "MidBone.position",
  [0, 1],
  [0, 0.05, 0, 0, 0.9, 0] // en t=1 el hueso medio sube a 0.9 (postura de pie real)
);
const tipTrack = new THREE.VectorKeyframeTrack(
  "TipBone.position",
  [0, 1],
  [0, 0.05, 0, 0, 0.6, 0]
);
const clip = new THREE.AnimationClip("stand", 1, [track, tipTrack]);
const mixer = new THREE.AnimationMixer(inner);

const box = computeModelBounds(inner, mixer, [clip]);
const size = new THREE.Vector3(); box.getSize(size);

console.log(`Tamaño calculado por computeModelBounds a partir del esqueleto animado: x=${size.x.toFixed(3)} y=${size.y.toFixed(3)} z=${size.z.toFixed(3)}`);

// La bind pose (sin animar) de este esqueleto sintético mide ~0.1 de alto (aplastada a propósito).
// Si computeModelBounds usara solo Box3.setFromObject (bind pose cruda), y saliera ~0.1 de alto,
// sería la regresión exacta que sufrió CesiumMan. Con la corrección (recorre huesos animados), debe
// acercarse a la altura real de pie (~0.9 + margen de 0.15 por lado = 1.2, tolerancia amplia).
if (size.y < 0.5) {
  fail(`computeModelBounds() devolvió una altura de ${size.y.toFixed(3)} -- parece estar usando la bind pose cruda (aplastada) en vez de recorrer la animación por huesos. Esto es exactamente la regresión que causó que CesiumMan se exportara como una lámina casi invisible.`);
} else {
  ok(`computeModelBounds() usa la pose animada (altura ${size.y.toFixed(3)}, no la bind pose aplastada ~0.1) -- normalización de escala/suelo de modelos con esqueleto correcta.`);
}

process.exit(hadFailure ? 1 : 0);
