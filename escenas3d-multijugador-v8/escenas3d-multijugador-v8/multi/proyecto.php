<?php
/**
 * proyecto.php
 * Guarda y sirve el proyecto (.json) asociado a un código de sala, para que
 * quien entra por un enlace compartido (?sala=XXX) cargue automáticamente el
 * mismo escenario 3D -- no solo se vean los avatares unos a otros.
 *
 * A diferencia de presencia.php/signal.php/chat.php (datos efímeros, TTL de
 * segundos), esto SÍ persiste sin caducidad: el enlace debe seguir sirviendo
 * el mismo proyecto días o semanas después. Si quieres borrar uno compartido,
 * borra a mano el fichero correspondiente en data/proyectos/ de tu servidor.
 *
 * Los proyectos pueden pesar varios MB (modelos .glb, imágenes, vídeo, música
 * van en base64 dentro del JSON) -- muy por encima de lo que maneja el resto
 * del módulo. El límite real de subida lo pone "post_max_size" en el php.ini
 * de tu hosting (cPanel: Select PHP Version -> Options), no solo esta MAX_PROYECTO.
 *
 * POST { sala, proyecto }   -> guarda/actualiza el proyecto de esa sala
 * GET  ?sala=XXX            -> devuelve el proyecto guardado tal cual (o 404)
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

define('DIR_PROYECTOS', __DIR__ . '/data/proyectos/');
define('MAX_PROYECTO', 60 * 1024 * 1024); // 60MB de margen propio -- ver aviso de post_max_size arriba

if (!is_dir(DIR_PROYECTOS)) {
    mkdir(DIR_PROYECTOS, 0750, true);
    file_put_contents(DIR_PROYECTOS . '.htaccess', "Deny from all\n");
}

function validarSalaProyecto($s) {
    $s = trim($s ?? '');
    return preg_match('/^[a-zA-Z0-9_-]{3,40}$/', $s) ? $s : null;
}

/* ── GET: descargar el proyecto guardado para esa sala ─────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $sala = validarSalaProyecto($_GET['sala'] ?? '');
    if (!$sala) { http_response_code(422); echo json_encode(['error' => 'sala inválida']); exit; }
    $f = DIR_PROYECTOS . $sala . '.json';
    if (!file_exists($f)) { http_response_code(404); echo json_encode(['error' => 'sin proyecto para esa sala']); exit; }
    // Se sirve el proyecto tal cual se guardó (ya es JSON válido, comprobado al recibirlo) --
    // evita decodificar/recodificar en PHP un fichero potencialmente grande.
    readfile($f);
    exit;
}

/* ── POST: guardar/actualizar el proyecto de esa sala ──────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $sala = validarSalaProyecto($_POST['sala'] ?? ($_GET['sala'] ?? ''));
    $body = file_get_contents('php://input');

    // Por defecto el cuerpo ES el proyecto tal cual (lo que manda index.html). Si en vez de eso
    // llega envuelto como { sala, proyecto }, lo desempaquetamos aquí. OJO: si $body viniera
    // truncado (p.ej. por un post_max_size del hosting menor que el proyecto real), json_decode
    // devuelve null y sencillamente NO entra en la rama del envoltorio -- $proyectoJson se queda
    // con el cuerpo tal cual, truncado, y el chequeo de json_decode() de más abajo es quien lo
    // detecta y da el aviso correcto (en vez de un "proyecto vacío" que despistaría más).
    $proyectoJson = $body;
    $decoded = json_decode($body, true);
    if (is_array($decoded) && isset($decoded['proyecto']) && !isset($decoded['don_claude_3d_project'])) {
        if (!$sala) $sala = validarSalaProyecto($decoded['sala'] ?? '');
        $proyectoJson = is_string($decoded['proyecto']) ? $decoded['proyecto'] : json_encode($decoded['proyecto']);
    }

    if (!$sala) { http_response_code(422); echo json_encode(['error' => 'sala inválida']); exit; }
    if (!$proyectoJson) { http_response_code(422); echo json_encode(['error' => 'falta el proyecto (JSON) en el cuerpo']); exit; }
    if (strlen($proyectoJson) > MAX_PROYECTO) {
        http_response_code(413);
        echo json_encode(['error' => 'proyecto demasiado grande (máx ' . (MAX_PROYECTO / 1024 / 1024) . 'MB)']);
        exit;
    }
    if (json_decode($proyectoJson) === null) {
        // Si post_max_size del servidor era menor que el cuerpo real, PHP trunca la entrada
        // silenciosamente y esto es lo primero que lo detecta -- de ahí el mensaje concreto.
        http_response_code(400);
        echo json_encode(['error' => 'JSON inválido o incompleto -- revisa post_max_size en el php.ini de tu hosting']);
        exit;
    }

    $ok = file_put_contents(DIR_PROYECTOS . $sala . '.json', $proyectoJson, LOCK_EX);
    echo json_encode(['ok' => (bool) $ok]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'método no permitido']);
