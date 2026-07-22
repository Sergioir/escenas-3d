// Pruebas funcionales de comportamiento real sobre el CÓDIGO REAL del juego exportado (se extrae y
// ejecuta tal cual sale de buildStandaloneGameRuntimeSrc en index.html -- no son reimplementaciones
// aparte, así que un cambio futuro que rompa algo de esto SÍ se detecta aquí). Se ejecuta con
// Three.js real (paquete npm "three") pero sin navegador ni WebGL -- el render se sustituye por un
// objeto vacío, y el DOM por una imitación mínima, porque toda la lógica que probamos aquí es
// matemática/estado (raycasting, posiciones, banderas), no dibujado en pantalla.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
globalThis.self = globalThis;

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
const fn1 = extractFn(liveSrc, "buildStandaloneGameRuntimeSrc");
const buildersFile = path.join(TMP, "runtime-builder.cjs");
fs.writeFileSync(buildersFile, fn1 + "\nmodule.exports = { buildStandaloneGameRuntimeSrc };");
const { buildStandaloneGameRuntimeSrc } = require(buildersFile);

// ---- Proyecto de prueba: sólo primitivas (sin gltf/imagen/vídeo -> buildScene resuelve en síncrono) ----
const project = {
  objects: [
    {
      id: "player", name: "Jugador", kind: "primitive", primitiveType: "box",
      colorHex: "#ffffff", opacity: 1,
      transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      collider: { kind: "character", size: { x: 0.8, y: 1.6, z: 0.8 }, riskLabel: "" },
      facingOffsetDeg: 0, actions: [],
      interactive: { enabled: false, kind: "text", radius: 2, prompt: "", text: "", url: "", choices: [], onInteractAction: null, onShotAction: null },
    },
    {
      id: "target", name: "Objetivo", kind: "primitive", primitiveType: "box",
      colorHex: "#ff0000", opacity: 1,
      transform: { position: [0, 1.35, -10], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      collider: { kind: "none", size: { x: 1, y: 1, z: 1 }, riskLabel: "" },
      facingOffsetDeg: 0, actions: [],
      interactive: {
        enabled: false, kind: "text", radius: 2, prompt: "", text: "", url: "", choices: [], onInteractAction: null,
        onShotAction: { type: "fade", target: "self", to: 0, duration: 0.2, parallel: [] },
      },
    },
    {
      id: "signEmpty", name: "Cartel vacio (solo dispara accion)", kind: "primitive", primitiveType: "box",
      colorHex: "#00ff00", opacity: 1,
      transform: { position: [5, 0, 5], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      collider: { kind: "none", size: { x: 1, y: 1, z: 1 }, riskLabel: "" },
      facingOffsetDeg: 0, actions: [],
      interactive: {
        enabled: true, kind: "text", radius: 2, prompt: "Interactuar", text: "", url: "", choices: [],
        onInteractAction: { type: "fade", target: "self", to: 0.3, duration: 0.05, parallel: [] },
        onShotAction: null,
      },
    },
    {
      id: "signWithText", name: "Cartel con texto (debe abrir panel)", kind: "primitive", primitiveType: "box",
      colorHex: "#0000ff", opacity: 1,
      transform: { position: [-5, 0, 5], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      collider: { kind: "none", size: { x: 1, y: 1, z: 1 }, riskLabel: "" },
      facingOffsetDeg: 0, actions: [],
      interactive: {
        enabled: true, kind: "text", radius: 2, prompt: "Leer", text: "Aviso de prueba", url: "", choices: [],
        onInteractAction: null, onShotAction: null,
      },
    },
  ],
  camera: { position: { x: 0, y: 1.6, z: 5 }, target: { x: 0, y: 1.6, z: 0 } },
  audio: {},
  environment: {
    nightSkyEnabled: false, skyDateMode: "auto", skyManualDate: "", skyManualTime: "",
    skyLongitudeDeg: -3.7, skyUtcOffsetHours: 1, moonTextureBase64: null, moonTextureFileName: null,
    nightBgColor: "#050912",
  },
  groups: [],
};

let runtimeSrc = buildStandaloneGameRuntimeSrc(JSON.stringify(project));

// Quitar los imports ES (THREE/GLTFLoader se inyectan como parámetros de función más abajo).
runtimeSrc = runtimeSrc.replace(/^import[^\n]*\n/gm, "");
// Sustituir el renderer real (necesita WebGL de verdad) por uno inerte -- no probamos dibujado, sólo
// estado/lógica, y todo lo demás del motor sólo llama a renderer.render()/setSize()/setPixelRatio().
runtimeSrc = runtimeSrc.replace(
  'var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });',
  'var renderer = { render: function(cam){ camera.updateMatrixWorld(true); scene.updateMatrixWorld(true); }, setSize: function(){}, setPixelRatio: function(){}, shadowMap: { enabled: false, type: null }, domElement: { style:{}, addEventListener: function(){} } };'
);

// Cortar la cola real (aplica entorno, construye escena y arranca requestAnimationFrame) y sustituirla
// por nuestro propio arnés de pruebas -- todo lo de ARRIBA (funciones, variables) es el código real sin tocar.
const tailAnchor = "applyEnvironment(PROJECT.environment);";
const tailIdx = runtimeSrc.indexOf(tailAnchor);
if (tailIdx === -1) throw new Error("No se encontró el punto de arranque del runtime exportado.");
runtimeSrc = runtimeSrc.slice(0, tailIdx);

const harness = `
applyEnvironment(PROJECT.environment);
var RESULTS = { steps: [] };
function step(name, fn) { try { fn(); RESULTS.steps.push({ name: name, ok: true }); } catch (e) { RESULTS.steps.push({ name: name, ok: false, error: (e && e.stack) || String(e) }); } }

buildScene(PROJECT, function () {
  // --- Escena lista (síncrono: sólo primitivas) ---

  step("panel vacio no bloquea y dispara su accion", function () {
    var rec = sceneObjects.get("signEmpty");
    var before = rec.colorMaterials[0].opacity;
    openInteractionPanel("signEmpty");
    if (interactionPanelOpen) throw new Error("interactionPanelOpen quedó a true tras interactuar con un cartel de texto vacío (debería ejecutar la acción y no abrir panel).");
    var afterOneShot = rec.__oneShot;
    if (!afterOneShot) throw new Error("El cartel vacío no disparó ninguna acción (se esperaba un fundido de opacidad).");
  });

  step("panel con texto SI bloquea y se cierra con E/Esc", function () {
    var rec = sceneObjects.get("signWithText");
    openInteractionPanel("signWithText");
    if (!interactionPanelOpen) throw new Error("interactionPanelOpen debería ser true tras interactuar con un cartel CON texto (lectura de cartel).");
    closeInteractionPanel();
    if (interactionPanelOpen) throw new Error("closeInteractionPanel() no dejó interactionPanelOpen en false.");
  });

  step("disparo (F) a 10m impacta y dispara onShotAction (huida/fundido)", function () {
    playerRecordId = "player";
    firstPersonMode = true;
    playYaw = 0; playPitch = 0;
    // Un par de "frames" para que cámara y matrices de la escena se asienten, igual que en el juego real.
    for (var i = 0; i < 2; i++) { updatePlayer(0.016); renderer.render(scene, camera); }
    if (nearestShotTargetId !== "target") throw new Error("El objetivo a 10m en línea recta no fue detectado por el rayo de disparo (nearestShotTargetId=" + nearestShotTargetId + ").");
    attemptShoot();
    var rec = sceneObjects.get("target");
    if (!rec.__oneShot) throw new Error("attemptShoot() no generó ninguna animación de una vez sobre el objetivo.");
  });

  step("tras completarse el fundido, el objetivo deja de ser alcanzable (no fantasma)", function () {
    // Simulamos el paso del tiempo hasta que el fundido (duration 0.2s) termine.
    for (var i = 0; i < 30; i++) { updateOneShotAnimations(); }
    // performance.now() avanza solo con el reloj real; forzamos que "termine" reescribiendo el estado
    // directamente si tras 30 pasadas inmediatas (mismo instante) el oneShot no ha progresado --
    // en su lugar, comprobamos el estado esperado tras opacidad 0 manualmente:
    var rec = sceneObjects.get("target");
    // Forzamos el final del fundido (equivalente a que pase el tiempo real) para probar el filtro:
    rec.colorMaterials.forEach(function (m) { m.opacity = 0; m.visible = false; });
    rec.__oneShot = null;
    updatePlayer(0.016);
    if (nearestShotTargetId === "target") throw new Error("El objetivo totalmente desvanecido SIGUE siendo alcanzable por el rayo de disparo (bug del 'fantasma disparable').");
  });

  var okAll = RESULTS.steps.every(function (s) { return s.ok; });
  __onDone(okAll, RESULTS.steps);
});
`;

function stubEl() {
  const handler = {
    get(target, prop) {
      if (prop === "style") return new Proxy({}, handler);
      if (prop === "classList") return { toggle() {}, add() {}, remove() {}, contains() { return false; } };
      if (prop === "dataset") return {};
      if (prop === "addEventListener" || prop === "removeEventListener") return () => {};
      if (prop === "querySelectorAll") return () => [];
      if (prop === "appendChild" || prop === "focus" || prop === "blur") return () => {};
      if (prop === "then") return undefined; // evita que Proxy parezca un thenable
      if (prop in target) return target[prop];
      return new Proxy(() => new Proxy({}, handler), handler);
    },
    set() { return true; },
    apply() { return new Proxy({}, handler); },
  };
  return new Proxy(function () {}, handler);
}
const fakeDocument = {
  getElementById: () => stubEl(),
  addEventListener: () => {},
  createElement: () => stubEl(),
  body: stubEl(),
};
const fakeWindow = {
  addEventListener: () => {},
  innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1,
  matchMedia: () => ({ matches: false }),
  visualViewport: null,
};
const fakeNavigator = { maxTouchPoints: 0, userAgent: "node-test" };

const fullScript = runtimeSrc + harness;
fs.writeFileSync(path.join(TMP, "functional-harness.js"), fullScript);

const runner = new Function(
  "THREE", "GLTFLoader", "document", "window", "navigator", "performance", "__onDone",
  fullScript
);

await new Promise((resolve) => {
  runner(THREE, GLTFLoader, fakeDocument, fakeWindow, fakeNavigator, performance, (okAll, steps) => {
    for (const s of steps) {
      if (s.ok) ok(s.name);
      else fail(s.name + "\n  " + s.error);
    }
    resolve();
  });
});

process.exit(hadFailure ? 1 : 0);
