<?php
/**
 * presencia.php v2
 * Descubrimiento de "quién está en esta sala ahora mismo".
 *
 * Adaptado de ping.php (compañía.es): mismo patrón de ficheros efímeros,
 * sin base de datos, sin registro. Aquí no hay geolocalización ni blur de
 * privacidad — la "sala" es el criterio de visibilidad (normalmente el
 * nombre/código del proyecto 3D compartido).
 *
 * Cambios v2:
 *  - Campo opcional "imagen" (textura del avatar en base64, JPEG/PNG/WebP,
 *    máx. ~20KB ya codificada) para que los demás visitantes de la sala
 *    puedan verla en tu avatar remoto, no solo tú.
 *
 * Este endpoint NO transporta posición 3D en cada frame — eso iría por el
 * canal de datos WebRTC (mundo-multi.js) una vez establecida la conexión
 * P2P entre dos peers. presencia.php solo sirve para que un peer nuevo
 * sepa a quién debe llamar (signal.php) para iniciar esa conexión.
 *
 * POST { sid, sala, nombre, imagen? }  -> guarda/renueva presencia, devuelve peers de la sala
 * GET  ?sala=XXX                       -> lista de peers activos en la sala (sin registrar)
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

define('DIR_SESIONES', __DIR__ . '/data/presencia/');
define('TTL',           30);   // segundos sin presencia -> se considera desconectado
define('MAX_SESIONES',  200);  // límite de peers simultáneos en toda la instalación
define('MAX_IMAGEN',  20000);  // bytes ya en base64 -- imagen pequeña (ver validarImagen)

if (!is_dir(DIR_SESIONES)) {
    mkdir(DIR_SESIONES, 0750, true);
    file_put_contents(DIR_SESIONES . '.htaccess', "Deny from all\n");
}

function validarSid($s)  { return preg_match('/^sess_[a-zA-Z0-9]{8,32}$/', $s ?? '') ? $s : null; }
function validarSala($s) {
    $s = trim($s ?? '');
    // Código de sala: letras/números/guiones, 3-40 caracteres — cómodo de compartir por enlace o pizarra
    return preg_match('/^[a-zA-Z0-9_-]{3,40}$/', $s) ? $s : null;
}
function validarImagen($img) {
    if (empty($img) || !is_string($img)) return null;
    if (strlen($img) > MAX_IMAGEN) return null;
    if (!preg_match('/^data:image\/(jpeg|png|webp);base64,/', $img)) return null;
    return $img;
}

function limpiarCaducados() {
    $t = time();
    foreach (glob(DIR_SESIONES . '*.json') ?: [] as $f) {
        $d = @json_decode(@file_get_contents($f), true);
        if (!$d || ($t - ($d['ts'] ?? 0)) > TTL) @unlink($f);
    }
}

/* ── GET: solo consultar, sin registrar presencia propia ──────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    limpiarCaducados();
    $sala = validarSala($_GET['sala'] ?? '');
    if (!$sala) { http_response_code(422); echo json_encode(['error' => 'sala inválida']); exit; }
    $peers = [];
    foreach (glob(DIR_SESIONES . '*.json') ?: [] as $f) {
        $d = @json_decode(@file_get_contents($f), true);
        if ($d && $d['sala'] === $sala) {
            $peers[] = ['sid' => $d['sid'], 'nombre' => $d['nombre'], 'imagen' => $d['imagen'] ?? null];
        }
    }
    echo json_encode(['ok' => true, 'peers' => $peers]);
    exit;
}

/* ── POST: registrar/renovar presencia y devolver peers de la sala ────── */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    limpiarCaducados();
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { http_response_code(400); echo json_encode(['error' => 'JSON inválido']); exit; }

    $sid    = validarSid($data['sid'] ?? '');
    $sala   = validarSala($data['sala'] ?? '');
    $nombre = mb_substr(trim($data['nombre'] ?? 'Visitante'), 0, 32);
    $imagen = validarImagen($data['imagen'] ?? null);

    if (!$sid || !$sala) {
        http_response_code(422); echo json_encode(['error' => 'sid/sala inválidos']); exit;
    }

    $activos = 0;
    foreach (glob(DIR_SESIONES . '*.json') ?: [] as $f) { $activos++; }

    if ($activos < MAX_SESIONES || file_exists(DIR_SESIONES . $sid . '.json')) {
        file_put_contents(
            DIR_SESIONES . $sid . '.json',
            json_encode(['sid' => $sid, 'sala' => $sala, 'nombre' => $nombre, 'imagen' => $imagen, 'ts' => time()]),
            LOCK_EX
        );
    }

    $peers = [];
    foreach (glob(DIR_SESIONES . '*.json') ?: [] as $f) {
        $d = @json_decode(@file_get_contents($f), true);
        if ($d && $d['sala'] === $sala && $d['sid'] !== $sid) {
            $peers[] = ['sid' => $d['sid'], 'nombre' => $d['nombre'], 'imagen' => $d['imagen'] ?? null];
        }
    }
    echo json_encode(['ok' => true, 'peers' => $peers]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'método no permitido']);
