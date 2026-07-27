/**
 * mundo-multi.js
 * Módulo de "visitantes" para escenas-3d.infodocencia.net — avatares y chat
 * en tiempo real dentro de "Modo jugar", sin Node.js.
 *
 * Arquitectura (mismo patrón que compañía.es, adaptado de geolocalización a
 * "sala" de proyecto 3D):
 *
 *   1. presencia.php — cada pocos segundos anuncia "estoy en la sala X" y
 *      recibe la lista de quién más está en esa sala ahora mismo. Solo sirve
 *      para DESCUBRIR peers, no transporta posición 3D (sería demasiado
 *      tráfico para un backend de ficheros).
 *
 *   2. signal.php — buzón de señalización WebRTC (offer/answer/ICE) para que
 *      dos navegadores negocien una conexión P2P directa entre ellos.
 *
 *   3. Una vez conectados, la posición (alta frecuencia, no crítica si se
 *      pierde algún paquete) y el chat (baja frecuencia, fiable) viajan por
 *      RTCDataChannel directamente entre navegadores — CERO carga en el
 *      servidor PHP a partir de ahí.
 *
 *   4. chat.php — solo como red de seguridad: si dos peers no logran
 *      conectar en P2P (redes de colegio muy restrictivas, sin TURN), el
 *      chat de texto todavía puede viajar retransmitido por el servidor. La
 *      posición NO tiene este respaldo — sin conexión P2P, ese avatar
 *      remoto simplemente no se moverá (ver aviso de TURN más abajo).
 *
 * AVISO SOBRE REDES RESTRICTIVAS (léelo antes de darlo por "no funciona"):
 * Solo se usa un servidor STUN público (Google) para descubrir la IP
 * pública de cada navegador. Eso basta en la mayoría de redes domésticas y
 * móviles, pero algunas redes de centro educativo usan NAT simétrico o
 * cortafuegos que bloquean la conexión directa — en ese caso dos navegadores
 * nunca llegan a conectar en P2P por mucho que lo reintenten. La solución
 * real es un servidor TURN (p. ej. coturn, gratis y open-source, o un
 * servicio de pago tipo Twilio/Metered) que reenvíe el tráfico cuando el
 * P2P directo es imposible. Se puede añadir sin tocar el resto del código:
 * pásalo en `iceServers` al llamar a MundoMulti.init(...).
 *
 * Uso (ver integración en index.html, sección "Modo jugar"):
 *
 *   MundoMulti.init({
 *     scene: scene,                                  // THREE.Scene
 *     crearAvatarRemoto: (nombre) => objeto3D,        // fábrica de avatar
 *     onChat: (nombre, texto, esMio, extra) => {...}, // extra: {privado, archivo:{nombre,mime,datos}|null}
 *     onEstado: (texto) => {...},                     // avisos ("conectando", errores...)
 *     onPeers: (n) => {...},                          // nº de peers conectados
 *     onListaPeers: (lista) => {...},                 // [{sid,nombre}, ...] -- para el selector "Para" (privado)
 *   });
 *   await MundoMulti.entrar('sala-demo', 'Sergio');
 *   MundoMulti.enviarPosicion(x, y, z, yaw);           // cada frame de Modo jugar
 *   MundoMulti.actualizarAvatares(dt);                 // cada frame de Modo jugar
 *   MundoMulti.enviarChat('hola!');                    // a toda la sala
 *   MundoMulti.enviarChat('psst', peerSid);             // privado, solo a ese peer
 *   MundoMulti.enviarArchivo(file, peerSid, (err) => {...}); // adjunto privado (imagen, PDF...)
 *   MundoMulti.listaConectados();                       // [{sid,nombre}, ...] bajo demanda
 *   MundoMulti.salir();
 */

const MundoMulti = (() => {

  /* ─── Configuración ──────────────────────────────────────────────────── */

  const PRESENCIA_URL         = 'multi/presencia.php';
  const SIGNAL_URL            = 'multi/signal.php';
  const CHAT_URL              = 'multi/chat.php';

  const PRESENCIA_INTERVAL_MS = 4000;   // descubrir peers nuevos/desaparecidos
  const SIGNAL_POLL_MS        = 1500;   // recoger ofertas/respuestas/ICE pendientes
  const CHAT_POLL_MS          = 2500;   // chat de respaldo Y posición de respaldo viajan por el mismo canal/ritmo
  const POS_SEND_MS           = 100;    // ~10 Hz — frecuencia de envío de posición por P2P
  const POS_FALLBACK_SEND_MS  = 1000;   // 1 Hz — respaldo por chat.php cuando el P2P no conecta (redes distintas, sin TURN)

  // Tope para adjuntos de chat (enviarArchivo): en base64 un binario pesa ~4/3 más, y chat.php
  // (respaldo por servidor) limita el campo "contenido" a 512KB -- este margen deja hueco de sobra
  // para el JSON envolvente {nombre,mime,datos} y evita el 413 del backend. El envío P2P (datachannel)
  // no tiene límite tan claro, pero conviene el mismo tope para que el comportamiento sea igual
  // llegue por donde llegue.
  const MAX_ARCHIVO_BYTES     = 350 * 1024;

  const ICE_SERVERS_DEFAULT = [
    { urls: 'stun:stun.l.google.com:19302' },
  ];

  /* ─── Estado interno ─────────────────────────────────────────────────── */

  let opts = {};
  let sid = null;
  let sala = null;
  let miNombre = 'Visitante';
  let miImagen = null; // textura del avatar en base64 (opcional), o null
  let iniciado = false;
  let presenciaTimer = null, signalTimer = null, chatPollTimer = null, posFallbackTimer = null;
  let ultimoEnvioPos = 0;
  let ultimaPosicionPropia = null; // {x,y,z,yaw} -- alimenta el respaldo por servidor, se actualiza cada frame aunque el envío P2P esté limitado por POS_SEND_MS
  let avisadoFalloPosicionRespaldo = false; // para no repetir el aviso en cada ciclo si el respaldo de posición falla
  const peers = new Map(); // sid -> peerState

  function peerVacio(sid, nombre, imagen) {
    return {
      sid, nombre,
      imagen: imagen || null,
      pc: null,
      dcPos: null, dcChat: null,
      pendientesICE: [],
      avatar: null,
      target: null,        // { x, y, z, yaw, t }
      actual: null,         // { x, y, z, yaw } — lo que se está pintando ahora mismo
      puntero: null,        // { x, y, z } — punto del mundo al que ese visitante está apuntando con la mira (puntero láser), o null
      vistoEnPresencia: true,
    };
  }

  /* ─── Identidad de sesión (persistente en esta pestaña) ─────────────── */

  function generarSid() {
    return 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function obtenerSid() {
    let s = sessionStorage.getItem('mundo3d_sid');
    if (!s) {
      s = generarSid();
      sessionStorage.setItem('mundo3d_sid', s);
    }
    return s;
  }

  /* ─── Utilidades ─────────────────────────────────────────────────────── */

  async function fetchJSON(url, options) {
    const res = await fetch(url, options);
    let data = null;
    try { data = await res.json(); } catch { /* respuesta no-JSON: la tratamos como error */ }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  function avisar(texto) {
    if (typeof opts.onEstado === 'function') opts.onEstado(texto);
  }

  function peerVisible(p) {
    return (p.pc && p.pc.connectionState === 'connected') || !!p.avatar;
  }
  function notificarNumPeers() {
    let n = 0;
    const lista = [];
    peers.forEach((p) => { if (peerVisible(p)) { n++; lista.push({ sid: p.sid, nombre: p.nombre }); } });
    if (typeof opts.onPeers === 'function') opts.onPeers(n);
    // Aparte de "cuántos" (onPeers), la sala necesita "quiénes" para poder elegir a quién susurrarle
    // un mensaje privado o un archivo -- ver enviarChat/enviarArchivo y el selector "Para" en index.html.
    if (typeof opts.onListaPeers === 'function') opts.onListaPeers(lista);
  }

  function anguloCorto(desde, hasta) {
    let d = (hasta - desde) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return desde + d;
  }

  /* ─── Señalización: envío ────────────────────────────────────────────── */

  function enviarSenal(action, to, payload) {
    if (!sid || !to) return;
    fetch(SIGNAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, from: sid, to, payload }),
      keepalive: true,
    }).catch(() => { /* red cortada: se reintentará solo si el peer nos vuelve a ofrecer */ });
  }

  /* ─── Canales de datos ───────────────────────────────────────────────── */

  function configurarCanal(peer, canal) {
    if (canal.label === 'pos') {
      peer.dcPos = canal;
      canal.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          peer.target = { x: d.x, y: d.y, z: d.z, yaw: d.yaw, t: performance.now() };
          peer.disfraz = d.disfraz || null; // p.ej. "gato" -- estado cosmético compartido (huevo de pascua)
          peer.puntero = d.puntero || null; // punto del mundo al que apunta con la mira (puntero láser), o null si no apunta a nada
          if (!peer.avatar && typeof opts.crearAvatarRemoto === 'function') {
            peer.avatar = opts.crearAvatarRemoto(peer.nombre, peer.imagen);
            peer.actual = { x: d.x, y: d.y, z: d.z, yaw: d.yaw };
            if (peer.avatar) {
              peer.avatar.position.set(d.x, d.y, d.z);
              peer.avatar.rotation.y = d.yaw;
              if (opts.scene) opts.scene.add(peer.avatar);
            }
          }
        } catch { /* mensaje corrupto: se ignora, llegará el siguiente en ~100ms */ }
      };
    } else if (canal.label === 'chat') {
      peer.dcChat = canal;
      canal.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (typeof opts.onChat === 'function') opts.onChat(peer.nombre, d.texto || '', false, { privado: !!d.privado, archivo: d.archivo || null });
        } catch { /* ignorar */ }
      };
    }
    canal.onopen = () => notificarNumPeers();
    canal.onclose = () => notificarNumPeers();
  }

  /* ─── Conexión RTCPeerConnection ─────────────────────────────────────── */

  function crearConexion(peer, soyIniciador) {
    const iceServers = (opts.iceServers && opts.iceServers.length) ? opts.iceServers : ICE_SERVERS_DEFAULT;
    const pc = new RTCPeerConnection({ iceServers });
    peer.pc = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) enviarSenal('ice', peer.sid, { candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      notificarNumPeers();
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cerrarPeer(peer.sid, false);
      }
    };
    pc.ondatachannel = (e) => configurarCanal(peer, e.channel);

    if (soyIniciador) {
      configurarCanal(peer, pc.createDataChannel('pos', { ordered: false, maxRetransmits: 0 }));
      configurarCanal(peer, pc.createDataChannel('chat', { ordered: true }));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        // Incluimos nuestro nombre/imagen en la oferta: si no, el otro lado nos ve con
        // el sid en crudo como nombre (y sin textura) hasta el siguiente ciclo de presencia (hasta 4s).
        .then(() => enviarSenal('offer', peer.sid, { sdp: pc.localDescription, nombre: miNombre, imagen: miImagen }))
        .catch(() => avisar('No se pudo iniciar la conexión con ' + peer.nombre));
    }
    return pc;
  }

  async function flushCandidatosPendientes(peer) {
    if (!peer.pc || !peer.pc.remoteDescription) return;
    while (peer.pendientesICE.length) {
      const c = peer.pendientesICE.shift();
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* candidato caducado: se ignora */ }
    }
  }

  async function manejarSenal(msg) {
    const from = msg.from;
    let peer = peers.get(from);

    if (msg.action === 'offer') {
      const nombreOfertante = (msg.payload && msg.payload.nombre) || from;
      const imagenOfertante = (msg.payload && msg.payload.imagen) || null;
      if (!peer) { peer = peerVacio(from, nombreOfertante, imagenOfertante); peers.set(from, peer); }
      else {
        if (peer.nombre === from) peer.nombre = nombreOfertante; // aún no confirmado por presencia.php
        if (!peer.imagen && imagenOfertante) peer.imagen = imagenOfertante;
      }
      if (!peer.pc) crearConexion(peer, false);
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
        await flushCandidatosPendientes(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        enviarSenal('answer', from, { sdp: peer.pc.localDescription });
      } catch { avisar('Fallo negociando conexión entrante'); }
      return;
    }

    if (!peer || !peer.pc) return; // answer/ice de un peer que ya no reconocemos

    if (msg.action === 'answer') {
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.payload.sdp));
        await flushCandidatosPendientes(peer);
      } catch { avisar('Fallo aceptando respuesta de conexión'); }
    } else if (msg.action === 'ice') {
      if (msg.payload && msg.payload.candidate) {
        if (peer.pc.remoteDescription) {
          try { await peer.pc.addIceCandidate(new RTCIceCandidate(msg.payload.candidate)); } catch { /* ignorar */ }
        } else {
          peer.pendientesICE.push(msg.payload.candidate);
        }
      }
    } else if (msg.action === 'bye') {
      cerrarPeer(from, false);
    }
  }

  function cerrarPeer(sidPeer, avisarAlOtro) {
    const peer = peers.get(sidPeer);
    if (!peer) return;
    if (avisarAlOtro) enviarSenal('bye', sidPeer, null);
    try { if (peer.pc) peer.pc.close(); } catch { /* ya cerrada */ }
    if (peer.avatar && opts.scene) {
      opts.scene.remove(peer.avatar);
      if (typeof opts.quitarAvatarRemoto === 'function') opts.quitarAvatarRemoto(peer.avatar);
    }
    peers.delete(sidPeer);
    notificarNumPeers();
  }

  /* ─── Bucle de presencia (descubrimiento de sala) ────────────────────── */

  async function ciclarPresencia() {
    try {
      const data = await fetchJSON(PRESENCIA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid, sala, nombre: miNombre, imagen: miImagen }),
        keepalive: true,
      });
      const vistos = new Set();
      (data.peers || []).forEach((p) => {
        vistos.add(p.sid);
        let peer = peers.get(p.sid);
        if (!peer) {
          peer = peerVacio(p.sid, p.nombre, p.imagen);
          peers.set(p.sid, peer);
          // Iniciador determinista: el sid "menor" ofrece, así solo se crea UNA
          // oferta por par y se evita el "glare" de dos ofertas cruzadas.
          if (sid < p.sid) crearConexion(peer, true);
        } else {
          peer.nombre = p.nombre; // por si cambió el nombre a media sesión
          if (p.imagen) peer.imagen = p.imagen;
        }
        peer.vistoEnPresencia = true;
      });
      // Peers que ya no aparecen en la sala (cerraron la pestaña, se fueron):
      // cerramos su conexión sin esperar al timeout de ICE.
      peers.forEach((peer, sidPeer) => {
        if (!vistos.has(sidPeer)) cerrarPeer(sidPeer, false);
      });
    } catch (err) {
      avisar('No se pudo contactar con presencia.php: ' + err.message);
    }
  }

  /* ─── Bucle de señalización (poll) ────────────────────────────────────── */

  async function ciclarSignal() {
    try {
      const data = await fetchJSON(SIGNAL_URL + '?sid=' + encodeURIComponent(sid));
      if (data.ok && data.mensajes && data.mensajes.length) {
        for (const msg of data.mensajes) await manejarSenal(msg);
      }
    } catch { /* red cortada: se reintenta en el siguiente ciclo */ }
  }

  /* ─── Bucle de chat de respaldo (solo peers sin datachannel abierto) ───
     También transporta la POSICIÓN de respaldo (tipo 'posicion') -- mismo
     canal que el chat en vez de un endpoint aparte: así solo hay que
     desplegar chat.php (que Sergio ya tenía comprobado que funciona) en vez
     de recordar subir un fichero nuevo cada vez. La textura del avatar ya
     viaja aparte por presencia.php (campo "imagen"), así que no hace falta
     repetirla aquí. ───────────────────────────────────────────────────── */

  async function ciclarChatRespaldo() {
    try {
      const data = await fetchJSON(CHAT_URL + '?sid=' + encodeURIComponent(sid));
      if (data.ok && data.mensajes && data.mensajes.length) {
        data.mensajes.forEach((m) => {
          if (m.tipo === 'posicion') {
            aplicarPosicionRespaldoRecibida(m);
            return;
          }
          if (typeof opts.onChat !== 'function') return;
          if (m.tipo === 'archivo') {
            let archivo = null;
            try { archivo = JSON.parse(m.contenido); } catch { /* adjunto corrupto: se ignora */ }
            if (archivo) opts.onChat(m.nombre || '?', '', false, { privado: !!m.privado, archivo });
            return;
          }
          opts.onChat(m.nombre || '?', m.contenido, false, { privado: !!m.privado, archivo: null });
        });
      }
      avisadoFalloPosicionRespaldo = false;
    } catch (err) {
      console.warn('Don Claude 3D: fallo consultando chat.php (chat y posición de respaldo):', err && err.message);
      if (!avisadoFalloPosicionRespaldo) {
        avisadoFalloPosicionRespaldo = true;
        avisar('Aviso: no se pudo consultar multi/chat.php -- ¿está subido al servidor? Sin él, si el P2P no conecta, no llegará ni el chat ni la posición de respaldo.');
      }
    }
  }

  function aplicarPosicionRespaldoRecibida(m) {
    const peer = peers.get(m.from);
    if (!peer) return; // solo respaldamos peers que presencia.php ya nos ha confirmado que están en la sala
    if (peer.dcPos && peer.dcPos.readyState === 'open') return; // el P2P ya funciona -- no lo pisamos con datos más lentos
    let p;
    try { p = JSON.parse(m.contenido); } catch { return; }
    if (typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') return;
    peer.target = { x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, t: performance.now() };
    peer.puntero = p.puntero || null;
    if (!peer.avatar && typeof opts.crearAvatarRemoto === 'function') {
      peer.avatar = opts.crearAvatarRemoto(peer.nombre, peer.imagen);
      peer.actual = { x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0 };
      if (peer.avatar) {
        peer.avatar.position.set(p.x, p.y, p.z);
        peer.avatar.rotation.y = p.yaw || 0;
        if (opts.scene) opts.scene.add(peer.avatar);
      }
      notificarNumPeers(); // ahora sí es "visible" aunque el P2P nunca haya conectado
    }
  }

  /* ─── Envío de posición de respaldo (solo a peers cuyo canal P2P 'pos' no
     está abierto -- típicamente porque están en redes distintas y no hay
     TURN configurado, ver aviso al principio de este fichero) ──────────── */

  function enviarPosicionRespaldo() {
    if (!ultimaPosicionPropia) return; // aún no hemos mandado ni un solo frame de posición
    const contenido = JSON.stringify(ultimaPosicionPropia);
    peers.forEach((peer) => {
      if (peer.dcPos && peer.dcPos.readyState === 'open') return; // el P2P ya funciona, no hace falta respaldo
      fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: sid, to: peer.sid, tipo: 'posicion', contenido, nombre: miNombre }),
        keepalive: true,
      }).catch(() => { /* red cortada: se reintenta en el siguiente ciclo */ });
    });
  }

  /* ─── API pública ─────────────────────────────────────────────────────── */

  function init(o) {
    opts = o || {};
    if (typeof RTCPeerConnection === 'undefined') {
      avisar('Este navegador no soporta WebRTC — el multijugador no está disponible.');
    }
  }

  async function entrar(nombreSala, nombreJugador, imagenB64) {
    if (iniciado) await salir();
    sid = obtenerSid();
    sala = String(nombreSala || '').trim();
    miNombre = String(nombreJugador || 'Visitante').trim().slice(0, 32) || 'Visitante';
    miImagen = (typeof imagenB64 === 'string' && imagenB64.slice(0, 11) === 'data:image/') ? imagenB64 : null;
    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(sala)) {
      avisar('Código de sala inválido (usa letras, números, guiones — 3 a 40 caracteres).');
      return false;
    }
    iniciado = true;
    ultimaPosicionPropia = null;
    avisadoFalloPosicionRespaldo = false;
    await ciclarPresencia();
    presenciaTimer = setInterval(ciclarPresencia, PRESENCIA_INTERVAL_MS);
    signalTimer    = setInterval(ciclarSignal, SIGNAL_POLL_MS);
    chatPollTimer  = setInterval(ciclarChatRespaldo, CHAT_POLL_MS);
    posFallbackTimer = setInterval(enviarPosicionRespaldo, POS_FALLBACK_SEND_MS);
    avisar('Sala "' + sala + '": buscando a otros visitantes…');
    return true;
  }

  async function salir() {
    if (!iniciado) return;
    iniciado = false;
    clearInterval(presenciaTimer); presenciaTimer = null;
    clearInterval(signalTimer); signalTimer = null;
    clearInterval(chatPollTimer); chatPollTimer = null;
    clearInterval(posFallbackTimer); posFallbackTimer = null;
    Array.from(peers.keys()).forEach((sidPeer) => cerrarPeer(sidPeer, true));
    sala = null;
  }

  function enviarPosicion(x, y, z, yaw, disfraz, puntero) {
    if (!iniciado) return;
    ultimaPosicionPropia = { x, y, z, yaw, puntero: puntero || null }; // alimenta ciclarPosicionRespaldo aunque el envío P2P de abajo esté limitado por POS_SEND_MS
    const ahora = performance.now();
    if (ahora - ultimoEnvioPos < POS_SEND_MS) return;
    ultimoEnvioPos = ahora;
    const msg = JSON.stringify({ x, y, z, yaw, disfraz: disfraz || null, puntero: puntero || null, t: ahora });
    peers.forEach((peer) => {
      if (peer.dcPos && peer.dcPos.readyState === 'open') {
        try { peer.dcPos.send(msg); } catch { /* canal cerrándose justo ahora: se ignora este frame */ }
      }
    });
  }

  // Envío de bajo nivel de un mensaje de chat (texto y/o archivo) a UN peer concreto: por su
  // datachannel si está abierto, si no por chat.php como respaldo -- exactamente el mismo patrón
  // que ya usaba enviarChat, solo que ahora también sirve para mensajes privados y adjuntos.
  function _enviarAPeer(peer, texto, archivo, privado) {
    if (peer.dcChat && peer.dcChat.readyState === 'open') {
      try { peer.dcChat.send(JSON.stringify({ texto, archivo: archivo || null, privado: !!privado })); return; } catch { /* cae al respaldo por servidor */ }
    }
    // Respaldo: el datachannel no está listo (o falló la conexión P2P entera).
    if (archivo) {
      fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: sid, to: peer.sid, tipo: 'archivo', contenido: JSON.stringify(archivo), nombre: miNombre, privado: !!privado }),
        keepalive: true,
      }).catch(() => {});
    } else {
      fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: sid, to: peer.sid, tipo: 'texto', contenido: texto, nombre: miNombre, privado: !!privado }),
        keepalive: true,
      }).catch(() => {});
    }
  }

  // paraSid opcional: si se omite (o el peer ya no está), se manda a TODA la sala como hasta ahora.
  // Si se indica el sid de un peer conectado, el mensaje va SOLO a esa persona (privado/susurro) --
  // ver el selector "Para" en index.html.
  function enviarChat(texto, paraSid) {
    texto = String(texto || '').trim().slice(0, 500);
    if (!texto) return;
    const destino = paraSid ? peers.get(paraSid) : null;
    const privado = !!destino;
    if (typeof opts.onChat === 'function') opts.onChat(miNombre, texto, true, { privado, archivo: null });
    if (destino) { _enviarAPeer(destino, texto, null, true); return; }
    peers.forEach((peer) => _enviarAPeer(peer, texto, null, false));
  }

  // Adjunta un fichero (imagen, PDF, lo que sea) leído como data URL en base64. callback(err) se
  // llama una vez validado y despachado (err=null si todo fue bien) -- el envío en sí es best-effort,
  // igual que enviarChat, así que un "sin error" aquí solo confirma que se leyó y se intentó mandar.
  // Por ahora siempre requiere un destinatario concreto (paraSid): compartir un binario suelto con
  // según qué visitante desconocido de una sala pública es más cosa de mandárselo a alguien elegido
  // que de emitirlo a todo el mundo -- para eso ya está el chat de texto normal.
  function enviarArchivo(file, paraSid, callback) {
    callback = typeof callback === 'function' ? callback : function () {};
    const destino = paraSid ? peers.get(paraSid) : null;
    if (!destino) { callback(new Error('Elige a quién enviárselo primero.')); return; }
    if (!file || !file.size) { callback(new Error('Archivo no válido.')); return; }
    if (file.size > MAX_ARCHIVO_BYTES) {
      callback(new Error('Demasiado grande (máx. ' + Math.floor(MAX_ARCHIVO_BYTES / 1024) + ' KB) -- ' + Math.ceil(file.size / 1024) + ' KB.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const archivo = { nombre: String(file.name || 'archivo').slice(0, 128), mime: file.type || 'application/octet-stream', datos: e.target.result };
      if (typeof opts.onChat === 'function') opts.onChat(miNombre, '', true, { privado: true, archivo });
      _enviarAPeer(destino, '', archivo, true);
      callback(null);
    };
    reader.onerror = () => callback(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  }

  // Lista de visitantes actualmente conectados en la sala (sid + nombre) -- para el selector "Para"
  // del chat privado en index.html. Ver también el callback opts.onListaPeers (se dispara solo).
  function listaConectados() {
    const lista = [];
    peers.forEach((p) => { if (peerVisible(p)) lista.push({ sid: p.sid, nombre: p.nombre }); });
    return lista;
  }

  function actualizarAvatares(dt) {
    const factor = 1 - Math.exp(-dt * 10); // suavizado exponencial, corrige drift de red sin "teletransportes"
    peers.forEach((peer) => {
      if (!peer.avatar || !peer.target || !peer.actual) return;
      peer.actual.x = peer.actual.x + (peer.target.x - peer.actual.x) * factor;
      peer.actual.y = peer.actual.y + (peer.target.y - peer.actual.y) * factor;
      peer.actual.z = peer.actual.z + (peer.target.z - peer.actual.z) * factor;
      peer.actual.yaw = anguloCorto(peer.actual.yaw, peer.target.yaw);
      peer.actual.yaw = peer.actual.yaw + (peer.target.yaw - peer.actual.yaw) * factor;
      peer.avatar.position.set(peer.actual.x, peer.actual.y, peer.actual.z);
      peer.avatar.rotation.y = peer.actual.yaw;
      if (typeof opts.actualizarDisfraz === 'function') opts.actualizarDisfraz(peer.avatar, peer.disfraz);
      if (typeof opts.actualizarPuntero === 'function') opts.actualizarPuntero(peer.avatar, peer.puntero);
    });
  }

  function numConectados() {
    let n = 0;
    peers.forEach((p) => { if (peerVisible(p)) n++; });
    return n;
  }

  function miSid() { return sid; }
  function estaActivo() { return iniciado; }

  // Avatares 3D actualmente visibles (uno por peer conectado que ya nos mandó su primera
  // posición) -- para que el cliente pueda usarlos, p.ej., como obstáculos de colisión al mover
  // a su propio jugador. No incluye peers sin avatar creado todavía.
  function listaAvatares() {
    const lista = [];
    peers.forEach((p) => { if (p.avatar) lista.push(p.avatar); });
    return lista;
  }

  return { init, entrar, salir, enviarPosicion, enviarChat, enviarArchivo, actualizarAvatares, numConectados, listaConectados, miSid, estaActivo, listaAvatares };

})();

window.MundoMulti = MundoMulti;
