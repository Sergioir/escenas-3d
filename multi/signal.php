<?php
/**
 * signal.php v3
 * Señalización WebRTC + memoria de chat efímera.
 *
 * Cambios v3:
 *  - Rate-limit de offers: máx 3 por par from→to en 60s
 *  - Limpieza automática de ficheros de rate-limit
 *
 * Cambios v2:
 *  - MAX_SDP subido a 32KB (TURN/relay candidates son grandes)
 *  - TTL subido a 120s (conexiones lentas en móvil)
 *  - MAX_MENSAJES subido a 50 (ráfaga de ICE candidates con TURN)
 *  - Endpoint /signal.php?action=memo para leer/escribir notas de sesión
 *    Los ficheros de memo se borran al recibir 'bye' o al caducar.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

define('DIR_SIGNAL', __DIR__ . '/data/signal/');
define('DIR_MEMO',   __DIR__ . '/data/memo/');
define('TTL_SIGNAL', 120);   // segundos — más tiempo para móvil lento
define('MAX_MENS',    50);   // candidatos ICE con TURN pueden ser muchos
define('MAX_SDP',   32768);  // 32 KB — SDP con TURN es grande

foreach ([DIR_SIGNAL, DIR_MEMO] as $dir) {
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
        file_put_contents($dir . '.htaccess', "Deny from all\n");
    }
}

function validarSid($s) {
    return preg_match('/^sess_[a-zA-Z0-9]{8,32}$/', $s ?? '') ? $s : null;
}

function limpiarCaducados() {
    $t = time();
    foreach (glob(DIR_SIGNAL . '*.json') ?: [] as $f) {
        $d = @json_decode(@file_get_contents($f), true);
        if (!$d || ($t - ($d['ts'] ?? 0)) > TTL_SIGNAL) @unlink($f);
    }
    // Memo: caduca en 24h (conversación terminada hace tiempo)
    foreach (glob(DIR_MEMO . '*.txt') ?: [] as $f) {
        if (($t - filemtime($f)) > 86400) @unlink($f);
    }
    // Limpiar ficheros de rate-limit expirados
    foreach (glob(DIR_SIGNAL . 'rate_*.json') ?: [] as $f) {
        $d = @json_decode(@file_get_contents($f), true);
        if (!$d || (time() - ($d['ts'] ?? 0)) > 60) @unlink($f);
    }
}

/* ── MEMO: notas de sesión efímeras ─────────────────────────────────── */
if (($_GET['action'] ?? '') === 'memo') {
    limpiarCaducados();
    $sid  = validarSid($_GET['sid'] ?? '');
    $peer = validarSid($_GET['peer'] ?? '');
    if (!$sid || !$peer) { http_response_code(422); echo json_encode(['error'=>'sid/peer inválido']); exit; }

    // Nombre del fichero: orden canónico para que ambos peers lean el mismo
    $ids  = [$sid, $peer]; sort($ids);
    $file = DIR_MEMO . implode('_', $ids) . '.txt';

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $txt = @file_get_contents($file) ?: '';
        echo json_encode(['ok'=>true, 'memo'=>$txt]);
    } elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true);
        $txt  = mb_substr(trim($body['memo'] ?? ''), 0, 4096); // max 4KB
        file_put_contents($file, $txt, LOCK_EX);
        echo json_encode(['ok'=>true]);
    } elseif ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        @unlink($file);
        echo json_encode(['ok'=>true]);
    }
    exit;
}

/* ── GET: poll ───────────────────────────────────────────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    limpiarCaducados();
    $sid = validarSid($_GET['sid'] ?? '');
    if (!$sid) { http_response_code(422); echo json_encode(['error'=>'sid inválido']); exit; }

    $msgs = [];
    foreach (glob(DIR_SIGNAL . $sid . '_*.json') ?: [] as $f) {
        $d = @json_decode(@file_get_contents($f), true);
        if ($d) { $msgs[] = $d; @unlink($f); }
    }
    echo json_encode(['ok'=>true, 'mensajes'=>$msgs]);
    exit;
}

/* ── POST: enviar ────────────────────────────────────────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    limpiarCaducados();
    $body = file_get_contents('php://input');
    $data = json_decode($body, true);
    if (!$data) { http_response_code(400); echo json_encode(['error'=>'JSON inválido']); exit; }

    $action = in_array($data['action'] ?? '', ['offer','answer','ice','bye']) ? $data['action'] : null;
    $from   = validarSid($data['from'] ?? '');
    $to     = validarSid($data['to']   ?? '');
    if (!$action || !$from || !$to) {
        http_response_code(422); echo json_encode(['error'=>'campos obligatorios']); exit;
    }

    $payload = $data['payload'] ?? null;
    if ($payload !== null && strlen(json_encode($payload)) > MAX_SDP) {
        http_response_code(413); echo json_encode(['error'=>'payload demasiado grande ('.MAX_SDP.'B max)']); exit;
    }

    if ($action === 'bye') {
        // Limpiar mensajes previos del emisor en la cola del destinatario
        foreach (glob(DIR_SIGNAL . $to . '_*.json') ?: [] as $f) {
            $m = @json_decode(@file_get_contents($f), true);
            if ($m && $m['from'] === $from) @unlink($f);
        }
        // Borrar memo de esta pareja
        $ids = [$from, $to]; sort($ids);
        @unlink(DIR_MEMO . implode('_', $ids) . '.txt');
        // Depositar el bye en la cola del destinatario para que lo recoja
        $fname = DIR_SIGNAL . $to . '_' . str_replace('.','', microtime(true)) . '.json';
        file_put_contents($fname, json_encode([
            'action'  => 'bye',
            'from'    => $from,
            'to'      => $to,
            'payload' => $payload,
            'ts'      => time(),
        ]), LOCK_EX);
        echo json_encode(['ok'=>true]); exit;
    }

    // Anti-flood global: cola del destinatario
    if (count(glob(DIR_SIGNAL . $to . '_*.json') ?: []) >= MAX_MENS) {
        http_response_code(429); echo json_encode(['error'=>'cola llena']); exit;
    }

    // Rate-limit específico para 'offer': máximo MAX_OFFERS_MIN offers
    // de un mismo 'from' hacia un mismo 'to' en OFFER_WINDOW segundos.
    // Evita que un cliente malintencionado spamee offers aunque manipule el JS.
    if ($action === 'offer') {
        define('MAX_OFFERS_MIN', 3);    // máx. 3 offers por ventana
        define('OFFER_WINDOW',   60);   // ventana de 60 segundos
        $rateFile = DIR_SIGNAL . 'rate_' . md5($from . '_' . $to) . '.json';
        $rateData = @json_decode(@file_get_contents($rateFile), true) ?: ['ts'=>0,'n'=>0];
        if ((time() - $rateData['ts']) > OFFER_WINDOW) {
            // Ventana nueva
            $rateData = ['ts'=>time(), 'n'=>1];
        } else {
            $rateData['n']++;
        }
        file_put_contents($rateFile, json_encode($rateData), LOCK_EX);
        if ($rateData['n'] > MAX_OFFERS_MIN) {
            http_response_code(429);
            echo json_encode(['error'=>'demasiadas solicitudes — espera un momento']);
            exit;
        }
    }

    $fname = DIR_SIGNAL . $to . '_' . str_replace('.','', microtime(true)) . '.json';
    $ok = file_put_contents($fname, json_encode([
        'action'  => $action,
        'from'    => $from,
        'to'      => $to,
        'payload' => $payload,
        'ts'      => time(),
    ]), LOCK_EX);
    echo json_encode(['ok'=>(bool)$ok]);
    exit;
}

http_response_code(405);
echo json_encode(['error'=>'método no permitido']);
