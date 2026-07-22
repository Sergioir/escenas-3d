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
 * PIN de edición (opcional): sin cuentas ni login, cualquiera con el enlace de
 * una sala podía sobrescribir el proyecto de otro con solo guardar con el mismo
 * código. Ahora, quien lo desee puede fijar un PIN corto la primera vez que
 * guarda una sala (o más tarde, mientras siga sin proteger) -- a partir de ahí,
 * hace falta ese mismo PIN para volver a guardar encima. El PIN se guarda
 * hasheado (password_hash) en un fichero aparte, nunca en claro. Las salas ya
 * compartidas ANTES de este cambio siguen sin PIN hasta que alguien decida
 * fijar uno -- no rompe enlaces existentes.
 *
 * POST { sala, proyecto, pin, proyectoBaseLigero }  -> guarda/actualiza el proyecto de esa sala
 *   - pin vacío/omitido: sin proteger (o exige el PIN si la sala ya estaba protegida)
 *   - pin presente y la sala NO estaba protegida: la protege de aquí en adelante
 *   - pin presente y la sala SÍ estaba protegida: debe coincidir, si no 403
 *
 * Edición cooperativa (fusión de guardados, no "quien guarda el último gana"): cuando dos personas
 * editan la misma sala a la vez, cada una parte de una versión ya cargada ("base"). Si al guardar el
 * servidor ya tiene una versión más reciente (guardada por la otra persona mientras tanto), en vez de
 * sobrescribirla sin más, se hace una fusión de 3 vías (base / lo local que llega / lo que ya había en
 * el servidor) objeto por objeto (por su "id"):
 *   - objeto nuevo (no estaba en la base) en cualquiera de los dos lados -> se conserva (ambas altas se
 *     suman, nadie pierde lo que acaba de añadir).
 *   - objeto sin cambios respecto a la base en un lado, pero editado o borrado en el otro -> gana el
 *     lado que sí cambió (si tú no lo tocaste, no hay nada que defender).
 *   - objeto editado en AMBOS lados a la vez (conflicto real sobre el mismo objeto) -> se conserva la
 *     versión ya guardada en el servidor (quien llega segundo no pisa en silencio), y el id se devuelve
 *     en "conflictos" para avisar a quien acaba de guardar que su cambio a ESE objeto concreto no entró.
 *   - objeto borrado en un lado pero editado en el otro desde la base -> se conserva la edición (no se
 *     deja que un borrado "a ciegas" tire por la borda una edición reciente de otra persona); también
 *     se reporta en "conflictos".
 * "proyectoBaseLigero" es la versión que el cliente tenía cargada antes de este guardado (para poder
 * distinguir "nuevo" de "editado" de "sin tocar"), con los campos pesados (modelos/imágenes/vídeo en
 * base64) quitados de cada objeto -- no hacen falta para comparar y doblarían el peso subido en cada
 * guardado si se mandaran completos. Si no se manda (o es null: primer guardado de la sesión, o cliente
 * antiguo), se trata como que no había base conocida -- en ese caso, ante el mismo id en ambos lados
 * gana lo ya guardado en el servidor (más conservador que arriesgarse a pisar contenido ajeno a ciegas).
 * La fusión ocurre dentro del mismo bloqueo de fichero (flock) que ya serializaba los guardados
 * concurrentes -- así que, de forma natural, cada guardado se resuelve del todo (lee + fusiona +
 * escribe) antes de que empiece el siguiente: es la "cola de guardados" que evita que dos escrituras
 * se pisen a medias.
 *
 * La respuesta añade "proyecto" (el resultado ya fusionado) para que quien acaba de guardar actualice
 * también su propia vista con el trabajo de los demás, no solo con el suyo.
 *
 * GET  ?sala=XXX                -> devuelve el proyecto guardado tal cual (o 404)
 * GET  ?sala=XXX&comprobarPin=1 -> { ok:true, protegida:true|false, version:int|null }, sin descargar
 *   el proyecto. "version" es la fecha de modificación (filemtime) del último guardado -- el cliente
 *   la usa para saber, sondeando cada pocos segundos, si alguien ha actualizado la sala sin tener que
 *   descargar el proyecto entero (que puede pesar varios MB) en cada sondeo.
 * POST ?sala=XXX&validarPin=1  { pin }  -> { ok:true } o 403 -- comprueba un PIN SIN guardar nada
 *   encima (para "Pulsar para editar": quien entra por enlace a una sala protegida arranca en modo
 *   visitante -- de solo ver/jugar -- y este PIN es lo que desbloquea el editor completo en su
 *   sesión). El PIN viaja en el CUERPO de un POST, nunca en la URL, para no dejarlo en logs de
 *   acceso del servidor. Nota de seguridad: como el guardado (POST normal, más abajo) ya distingue
 *   PIN correcto/incorrecto por su código de respuesta, esto no abre una vía de ataque nueva --
 *   sigue siendo el mismo PIN corto "para escribirlo a mano", no una contraseña robusta.
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

// PIN corto pensado para escribirlo a mano (no es una contraseña robusta) -- 4 a 16 letras/números.
// Devuelve '' si no se mandó ninguno (válido: significa "sin PIN"), o false si el formato no vale.
function validarPin($p) {
    $p = trim((string)($p ?? ''));
    if ($p === '') return '';
    return preg_match('/^[A-Za-z0-9]{4,16}$/', $p) ? $p : false;
}

function ficheroProyecto($sala) { return DIR_PROYECTOS . $sala . '.json'; }
function ficheroPin($sala)      { return DIR_PROYECTOS . $sala . '.pin'; }

// Huella ligera de un objeto de escena para comparar "¿ha cambiado de verdad?" sin arrastrar sus
// campos pesados (que además no viajan en la "base ligera" que manda el cliente -- ver docblock).
function huellaObjeto($obj) {
    if (!is_array($obj)) return json_encode($obj);
    foreach (['gltfBase64', 'imageBase64', 'videoBase64', 'textureBase64'] as $c) unset($obj[$c]);
    return json_encode($obj);
}

function indexarObjetosPorId($objetos) {
    $out = [];
    if (!is_array($objetos)) return $out;
    foreach ($objetos as $o) { if (is_array($o) && isset($o['id'])) $out[$o['id']] = $o; }
    return $out;
}

// Fusión de 3 vías por objeto (ver docblock arriba para la lógica completa). Devuelve
// ['proyecto' => <fusionado>, 'conflictos' => [ids de objetos donde no ganó lo local]].
function fusionarProyectos($base, $local, $servidor) {
    // Sin proyecto guardado todavía en el servidor: nada que fusionar, se guarda tal cual.
    if (!is_array($servidor) || !isset($servidor['objects'])) {
        return ['proyecto' => $local, 'conflictos' => []];
    }
    if (!is_array($local) || !isset($local['objects'])) {
        // No debería ocurrir (el JSON ya se validó antes de llegar aquí) -- por seguridad, no tocar nada.
        return ['proyecto' => $servidor, 'conflictos' => []];
    }

    $hayBase   = is_array($base) && isset($base['objects']);
    $baseObjs  = $hayBase ? indexarObjetosPorId($base['objects']) : [];
    $localObjs = indexarObjetosPorId($local['objects']);
    $servObjs  = indexarObjetosPorId($servidor['objects']);

    $todosLosIds = array_unique(array_merge(array_keys($localObjs), array_keys($servObjs)));
    $merged = [];
    $conflictos = [];

    foreach ($todosLosIds as $id) {
        $enLocal = array_key_exists($id, $localObjs);
        $enServ  = array_key_exists($id, $servObjs);
        $enBase  = $hayBase && array_key_exists($id, $baseObjs);

        $localCambio = $enBase && $enLocal && huellaObjeto($baseObjs[$id]) !== huellaObjeto($localObjs[$id]);
        $servCambio  = $enBase && $enServ  && huellaObjeto($baseObjs[$id]) !== huellaObjeto($servObjs[$id]);

        if ($enLocal && $enServ) {
            if ($localCambio && $servCambio) {
                $merged[] = $servObjs[$id]; // conflicto real: gana lo ya guardado, se avisa
                $conflictos[] = $id;
            } elseif ($localCambio) {
                $merged[] = $localObjs[$id];
            } else {
                $merged[] = $servObjs[$id]; // ni base->local cambió, o no hay base conocida: gana lo ya guardado
            }
        } elseif ($enLocal && !$enServ) {
            if (!$enBase) {
                $merged[] = $localObjs[$id]; // alta nueva de esta sesión
            } elseif ($localCambio) {
                $merged[] = $localObjs[$id]; // se restaura: tenía ediciones locales aunque alguien lo borrase
                $conflictos[] = $id;
            }
            // si no cambió localmente y ya no está en el servidor: lo borró otra persona -- se respeta, se omite
        } elseif (!$enLocal && $enServ) {
            if (!$enBase) {
                $merged[] = $servObjs[$id]; // alta de otra persona que este cliente no conocía
            } elseif ($servCambio) {
                $merged[] = $servObjs[$id]; // alguien lo editó mientras yo lo borraba -- no se pierde su edición
                $conflictos[] = $id;
            }
            // si no cambió en el servidor y yo lo borré localmente: se respeta el borrado, se omite
        }
    }

    $resultado = $local;
    $resultado['objects'] = $merged;

    // Campos "de un solo bloque" (no son listas de objetos con id): ambiente, música, cámara. Misma
    // idea a nivel de bloque completo -- gana quien realmente lo tocó desde la base; si nadie lo tocó
    // (o no hay base conocida) gana lo local, como hasta ahora.
    foreach (['environment', 'audio', 'camera'] as $campo) {
        $baseVal = $hayBase ? ($base[$campo] ?? null) : null;
        $localVal = $local[$campo] ?? null;
        $servVal = $servidor[$campo] ?? null;
        $localCambioCampo = $hayBase && json_encode($baseVal) !== json_encode($localVal);
        $servCambioCampo  = $hayBase && json_encode($baseVal) !== json_encode($servVal);
        if ($servCambioCampo && !$localCambioCampo) {
            $resultado[$campo] = $servVal; // no lo toqué, y alguien sí -- me quedo con lo suyo
        } else {
            $resultado[$campo] = $localVal;
        }
        if ($localCambioCampo && $servCambioCampo && json_encode($localVal) !== json_encode($servVal)) {
            $conflictos[] = $campo; // ambos lo tocasteis de forma distinta -- gana lo local, se avisa igualmente
        }
    }

    return ['proyecto' => $resultado, 'conflictos' => $conflictos];
}

/* ── POST ?validarPin=1: comprobar un PIN sin guardar nada encima ─────── */
if (isset($_GET['validarPin'])) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'usa POST']); exit; }
    $sala = validarSalaProyecto($_GET['sala'] ?? '');
    if (!$sala) { http_response_code(422); echo json_encode(['error' => 'sala inválida']); exit; }

    $decoded = json_decode(file_get_contents('php://input'), true);
    $pinRecibido = is_array($decoded) ? ($decoded['pin'] ?? '') : '';
    $pin = validarPin($pinRecibido);

    $pinFile = ficheroPin($sala);
    if (!file_exists($pinFile)) {
        // Sala sin proteger: no hay PIN que comprobar -- se considera "válido" (nada que desbloquear).
        echo json_encode(['ok' => true, 'protegida' => false]);
        exit;
    }
    $hashGuardado = @file_get_contents($pinFile);
    if ($pin === false || $pin === '' || !$hashGuardado || !password_verify($pin, $hashGuardado)) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'PIN incorrecto']);
        exit;
    }
    echo json_encode(['ok' => true, 'protegida' => true]);
    exit;
}

/* ── GET: descargar el proyecto guardado para esa sala (o solo comprobar si tiene PIN) ── */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $sala = validarSalaProyecto($_GET['sala'] ?? '');
    if (!$sala) { http_response_code(422); echo json_encode(['error' => 'sala inválida']); exit; }

    if (isset($_GET['comprobarPin'])) {
        $f = ficheroProyecto($sala);
        echo json_encode([
            'ok' => true,
            'protegida' => file_exists(ficheroPin($sala)),
            'version' => file_exists($f) ? filemtime($f) : null,
        ]);
        exit;
    }

    $f = ficheroProyecto($sala);
    if (!file_exists($f)) { http_response_code(404); echo json_encode(['error' => 'sin proyecto para esa sala']); exit; }
    // Se sirve el proyecto tal cual se guardó (ya es JSON válido, comprobado al recibirlo) --
    // evita decodificar/recodificar en PHP un fichero potencialmente grande. La lectura NO
    // requiere PIN: el PIN protege el guardado, no la visita por enlace.
    readfile($f);
    exit;
}

/* ── POST: guardar/actualizar el proyecto de esa sala ──────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $sala = validarSalaProyecto($_POST['sala'] ?? ($_GET['sala'] ?? ''));
    $body = file_get_contents('php://input');

    // Por defecto el cuerpo ES el proyecto tal cual. Si en vez de eso llega envuelto como
    // { sala, proyecto, pin }, lo desempaquetamos aquí. OJO: si $body viniera truncado (p.ej. por
    // un post_max_size del hosting menor que el proyecto real), json_decode devuelve null y
    // sencillamente NO entra en la rama del envoltorio -- $proyectoJson se queda con el cuerpo tal
    // cual, truncado, y el chequeo de json_decode() de más abajo es quien lo detecta y da el aviso
    // correcto (en vez de un "proyecto vacío" que despistaría más).
    $proyectoJson = $body;
    $pinRecibido = '';
    $baseLigera = null;
    $decoded = json_decode($body, true);
    if (is_array($decoded) && isset($decoded['proyecto']) && !isset($decoded['don_claude_3d_project'])) {
        if (!$sala) $sala = validarSalaProyecto($decoded['sala'] ?? '');
        $proyectoJson = is_string($decoded['proyecto']) ? $decoded['proyecto'] : json_encode($decoded['proyecto']);
        $pinRecibido = $decoded['pin'] ?? '';
        $baseLigera = $decoded['proyectoBaseLigero'] ?? null; // ver docblock: para fusionar en vez de sobrescribir
    }
    if ($pinRecibido === '') $pinRecibido = $_POST['pin'] ?? ($_GET['pin'] ?? '');

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

    $pin = validarPin($pinRecibido);
    if ($pin === false) { http_response_code(422); echo json_encode(['error' => 'PIN inválido: usa 4 a 16 letras o números']); exit; }

    $pinFile = ficheroPin($sala);
    $estaProtegida = file_exists($pinFile);
    if ($estaProtegida) {
        $hashGuardado = @file_get_contents($pinFile);
        if ($pin === '' || !$hashGuardado || !password_verify($pin, $hashGuardado)) {
            http_response_code(403);
            echo json_encode(['error' => 'PIN incorrecto o necesario para actualizar esta sala']);
            exit;
        }
    } elseif ($pin !== '') {
        // Sala sin proteger todavía: si mandan un PIN ahora (al crearla o más tarde), se fija a
        // partir de este guardado -- futuras actualizaciones lo exigirán.
        file_put_contents($pinFile, password_hash($pin, PASSWORD_DEFAULT), LOCK_EX);
    }

    // Lectura + fusión + escritura como UNA sola sección crítica bajo flock: si dos guardados llegan
    // a la vez, el segundo espera a que el primero suelte el bloqueo y entonces fusiona sobre el
    // resultado YA actualizado por el primero -- esa espera es, de hecho, la "cola de guardados" que
    // evita que dos escrituras se pisen a medias (ver docblock arriba).
    $rutaProyecto = ficheroProyecto($sala);
    $fp = fopen($rutaProyecto, 'c+');
    if (!$fp) { http_response_code(500); echo json_encode(['error' => 'no se pudo abrir el fichero de la sala']); exit; }
    flock($fp, LOCK_EX);

    $contenidoActual = stream_get_contents($fp);
    $servidorProyecto = $contenidoActual !== '' ? json_decode($contenidoActual, true) : null;
    $localProyecto = json_decode($proyectoJson, true); // ya comprobado como JSON válido más arriba

    $resultado = fusionarProyectos($baseLigera, $localProyecto, $servidorProyecto);
    $mergedJson = json_encode($resultado['proyecto']);

    ftruncate($fp, 0);
    rewind($fp);
    $ok = fwrite($fp, $mergedJson);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    echo json_encode([
        'ok' => $ok !== false,
        // Para que quien acaba de guardar actualice su propia "última versión conocida" sin
        // necesitar una segunda petición -- así el sondeo periódico (ver comprobarPin) no le avisa
        // de su propio guardado como si fuera un cambio ajeno.
        'version' => $ok !== false ? filemtime($rutaProyecto) : null,
        // El proyecto YA fusionado (con las altas/ediciones de los demás incorporadas), para que quien
        // acaba de guardar también actualice su propia vista con el trabajo ajeno, no solo el suyo.
        'proyecto' => $resultado['proyecto'],
        // ids de objetos (o "environment"/"audio"/"camera") donde hubo un conflicto real y NO ganó lo
        // que acababa de mandar este guardado -- para avisar, no para bloquear el guardado.
        'conflictos' => $resultado['conflictos'],
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'método no permitido']);
