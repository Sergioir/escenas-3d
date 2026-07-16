<?php
/**
 * chat.php — Relay de mensajes efimero
 * POST  { from, to, tipo, contenido, [nombre] }
 * GET   ?sid=XXX  -> mensajes pendientes (one-shot)
 * DELETE ?from=X&to=Y  -> borrar al colgar
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

define('DIR_CHAT', __DIR__ . '/data/chat/');
define('CHAT_TTL',  600);
define('MAX_MSGS',  200);
define('MAX_TXT',  65536);
define('MAX_BIN', 524288);

if (!is_dir(DIR_CHAT)) {
    mkdir(DIR_CHAT, 0750, true);
    file_put_contents(DIR_CHAT . '.htaccess', "Deny from all\n");
}
function vsid($s) { return preg_match('/^sess_[a-zA-Z0-9]{8,32}$/', $s ?? '') ? $s : null; }
function limpia() {
    $t = time();
    foreach (glob(DIR_CHAT . '*.json') ?: [] as $f) {
        $d = @json_decode(@file_get_contents($f), true);
        if (!$d || ($t - ($d['ts'] ?? 0)) > CHAT_TTL) @unlink($f);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $from = vsid($_GET['from'] ?? ''); $to = vsid($_GET['to'] ?? '');
    if (!$from || !$to) { http_response_code(422); echo json_encode(['error'=>'sid invalido']); exit; }
    foreach (glob(DIR_CHAT . '*.json') ?: [] as $f) {
        $d = @json_decode(@file_get_contents($f), true);
        if ($d && (($d['from']===$from&&$d['to']===$to)||($d['from']===$to&&$d['to']===$from))) @unlink($f);
    }
    echo json_encode(['ok'=>true]); exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    limpia();
    $sid = vsid($_GET['sid'] ?? '');
    if (!$sid) { http_response_code(422); echo json_encode(['error'=>'sid invalido']); exit; }
    $msgs = [];
    foreach (glob(DIR_CHAT . $sid . '_*.json') ?: [] as $f) {
        $d = @json_decode(@file_get_contents($f), true);
        if ($d) { $msgs[] = $d; @unlink($f); }
    }
    usort($msgs, fn($a,$b) => ($a['ts']??0) <=> ($b['ts']??0));
    echo json_encode(['ok'=>true, 'mensajes'=>$msgs]); exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    limpia();
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { http_response_code(400); echo json_encode(['error'=>'JSON invalido']); exit; }
    $from = vsid($data['from'] ?? ''); $to = vsid($data['to'] ?? '');
    $tipo = in_array($data['tipo'] ?? '', ['texto','imagen','audio','sistema']) ? $data['tipo'] : null;
    $cont = $data['contenido'] ?? '';
    if (!$from || !$to || !$tipo) { http_response_code(422); echo json_encode(['error'=>'campos']); exit; }
    $max = ($tipo==='texto'||$tipo==='sistema') ? MAX_TXT : MAX_BIN;
    if (strlen($cont) > $max) { http_response_code(413); echo json_encode(['error'=>'grande']); exit; }
    if (count(glob(DIR_CHAT . $to . '_*.json') ?: []) >= MAX_MSGS) { http_response_code(429); echo json_encode(['error'=>'llena']); exit; }
    $f = DIR_CHAT . $to . '_' . str_replace('.','', microtime(true)) . '.json';
    $ok = file_put_contents($f, json_encode(['from'=>$from,'to'=>$to,'tipo'=>$tipo,'contenido'=>$cont,'nombre'=>mb_substr($data['nombre']??'',0,128),'ts'=>time()]), LOCK_EX);
    echo json_encode(['ok'=>(bool)$ok]); exit;
}
http_response_code(405); echo json_encode(['error'=>'metodo no permitido']);
