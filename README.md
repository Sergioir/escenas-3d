# 🎬 Don Claude 3D

**Estudio de escenarios 3D interactivos, 100% en el navegador.**

Editor 3D sin instalación para crear escenarios interactivos: formación y
prevención de riesgos laborales, museos y recorridos virtuales,
presentaciones de alumnos o escenarios para webinars. Construye la escena,
añade animaciones e interacción, pruébala en modo jugador (con multijugador
opcional) y expórtala como un videojuego `.html` independiente para
compartir o incrustar donde quieras.

🔗 Demo en vivo: [escenas-3d.infodocencia.net](https://escenas-3d.infodocencia.net/)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

## Características

- **Editor visual** con gizmos de mover/rotar/escalar, historial (Ctrl+Z),
  ajuste a bordes cercanos y límites de escenario configurables. Si el
  navegador reclama el contexto gráfico (WebGL) tras dejar la pestaña
  inactiva un buen rato, avisa para guardar en vez de quedarse congelado
  sin explicación.
- **Biblioteca de formas y prefabs** (mesas, tablones, cajas, personaje...),
  clonado en serie con desplazamiento/rotación/escala en patrón. Con 2+
  objetos seleccionados, "Alinear / distribuir" los alinea por mínimo/
  centro/máximo en cada eje, o reparte el hueco entre ellos uniformemente.
- **Importación de modelos `.glb`**, incluidas sus animaciones — con
  corrección de orientación si el modelo "camina de espaldas".
- **Formas libres extruidas** (editor de nodos tipo Bézier): arrastra a
  mano o edita posición/manecillas por campos numéricos para precisión
  exacta, o genera un polígono/círculo perfecto de N lados. Incluye
  extrusión siguiendo un camino (path sweep, recto o en bucle) — con
  generador de camino circular o en espiral (muelles, rampas de caracol) y
  un parámetro de **torsión** (grados) que gira el perfil de principio a
  fin del camino. También admite **estrechamiento hacia el destino**
  (escala y desplazamiento X/Y del extremo final, con o sin camino): con
  escala 0 remata en un punto real (pirámide/cono), y con un desplazamiento
  el remate queda inclinado a un lado en vez de centrado.
- **Sistema de acciones** por objeto (mover, rotar, esperar, aparecer/
  desaparecer, animar, girar sin parar...) encadenables y en paralelo,
  con coordenadas relativas — sirve para ascensores, puertas, cintas
  transportadoras, etc. "Girar sin parar" admite marcarse como
  **indefinido** (gira para siempre, sin duración) y se puede frenar más
  tarde con la acción "Detener giro" desde un interruptor u otra pieza.
  Cualquier objeto también puede marcarse para **girar solo al empezar**
  (sin necesitar ningún disparador ni acción) — ideal para un molino,
  ventilador o aspa siempre en marcha.
- **Colisionadores simples**: personaje (detector), sólido, sólido con
  malla real (choca contra la forma de verdad en vez de su caja envolvente
  — para piezas huecas o curvas como una cúpula o un arco), suelo/rampa
  (incluye plataformas en movimiento que "arrastran" al jugador), zona de
  riesgo, volumen.
- **Objetos interactivos**: texto al acercarse, lectura con tecla E,
  enlaces, o preguntas de elección múltiple con puntuación y acciones
  propias por respuesta.
- **Imagen, vídeo y texto 3D** como contenido de escena: sube una imagen
  (cartel) o un vídeo (proyector, se reproduce/pausa con E) — se guardan en
  base64 dentro del proyecto y del exportado —, o añade un rótulo de
  "Texto 3D" dibujado sobre lienzo (sin depender de fuentes externas), que
  envuelve solo en líneas cuando el texto no cabe en el ancho fijado. Una
  imagen puede además marcarse para hacer un **agujero real** en la pieza
  sólida que tenga justo detrás (pégala contra una pared para simular una
  ventana calada: donde el png es transparente, la pared desaparece de
  verdad, se vea de cualquier grosor). Varias "ventanas" activas a la vez,
  aunque se solapen en pantalla o estén giradas, no mezclan sus agujeros
  entre sí. Para texturizar una pieza sólida
  entera (ladrillo, teja, verja...) está "Textura de imagen" en
  Propiedades, con un recorte nítido opcional por canal alfa en vez de
  difuminado suave.
- **Variables de proyecto y acciones de datos**: define variables
  (número/texto) y, como una acción más, asígnales un valor con una
  expresión segura (sin `eval`/`Function`), o pide datos a una URL
  (`fetchUrl`) para: no hacer nada con la respuesta, mostrarla como texto
  en un cartel, leer varias variables de un JSON, o usarla como imagen
  (una respuesta `data:image/...` en texto). También hay acción para
  copiar un valor al portapapeles, condicionales ("si") y bucles
  ("repetir N veces") para encadenar acciones según el estado del juego.
  Todo esto pasa por una puerta de permiso explícita del jugador antes de
  hacer ninguna petición de red.
- **Texturizado dinámico sin red**: dos acciones vuelcan el contenido de
  una variable directamente sobre un objeto de la escena sin llamar a
  ningún servidor — como imagen de un objeto "Imagen" (`setImageVar`) o
  como texto de un rótulo "Texto 3D" (`setTextVar`) — útil para simular
  documentos, paneles o pantallas que cambian durante la partida.
- **Mensajes superpuestos**: aviso en pantalla que se autocierra o espera
  a una tecla (`screenMessage`), y pregunta al jugador con entrada de
  texto y, opcionalmente, un archivo/imagen adjunto (`askInput`) que se
  guarda como variable — ambos pausan el movimiento mientras están
  abiertos y siguen la cadena de acciones al cerrarse.
- **Línea de tiempo** tipo "película guionizada", con grabación de vídeo.
- **Modo jugador**: control en primera/tercera persona (WASD + ratón,
  flechas de teclado, o joystick y botones táctiles en móvil), registro
  de eventos de riesgo, puntuación, y bloqueo de orientación en móvil
  mientras se juega (si el navegador lo permite).
- **Multijugador opcional**: código de sala compartido, chat, avatares con
  textura propia — vía WebRTC P2P con respaldo automático por servidor si
  la conexión directa no cuadra (ver [Multijugador](#multijugador-opcional)).
- **Compartir por enlace** (`?sala=`) con el proyecto persistido en el
  servidor y PIN de edición opcional ("Pulsar para editar": sin PIN, quien
  entra por el enlace ve el editor completo; con PIN, entra en modo
  visitante -- solo ver/jugar -- hasta que lo introduce). Mientras la
  pestaña sigue abierta en una sala, se sondea cada ~10s si alguien ha
  guardado cambios más recientes: a un visitante se le aplican solos; a
  quien está editando se le avisa con un botón "Cargar cambios" en vez de
  sobrescribirle en caliente lo que tenga sin guardar. Los guardados de
  varias personas en la misma sala se **fusionan** (no "quien guarda el
  último pisa al otro"): las altas de objetos de ambos lados se suman, las
  ediciones de quien realmente tocó algo se respetan, y solo si el MISMO
  objeto se edita a la vez desde los dos lados hay un aviso de conflicto
  (se mantiene la versión ya guardada y se señala qué revisar). La misma
  fusión se aplica también al CARGAR (botón "Cargar cambios"), no solo al
  guardar -- así una pestaña con ediciones aún sin guardar no las pierde
  al traer lo último de otra persona.
- **Exportación a videojuego `.html` independiente**, sin el editor, listo
  para compartir o incrustar (el multijugador no se incluye en este
  archivo exportado).
- **Guardar partida (opcional)**: activable por proyecto desde "Ambiente del
  escenario". Cuando está activa, tanto en Modo jugar como en el videojuego
  exportado aparecen botones "Guardar"/"Cargar" en pantalla: guardan la
  posición y orientación del jugador, la puntuación, las variables de juego y
  el estado (posición, opacidad, visibilidad) de cada objeto de la escena en
  un `.json` descargable, y también en el navegador (autoguardado cada 20s
  mientras se juega). Al volver a entrar se ofrece continuar donde se dejó.
- **Guardar/cargar proyecto** en un único `.json` (incluye modelos,
  imágenes, audio y vídeo en base64). Si el mismo archivo se usa en varios
  objetos (una foto de valla repetida en varios paneles, una textura de
  ladrillo en muchas piezas...) se guarda una sola vez y el resto solo
  referencia su id -- así una escena con contenido repetido no multiplica su
  peso por cada copia.
- **Bóveda celeste nocturna (opcional)**: activable desde "Ambiente del
  escenario". Cuando el Sol del escenario está bajo, aparecen ~750 estrellas
  reales (posiciones J2000, con las líneas de las 88 constelaciones IAU) más
  un fondo decorativo de relleno, y la Luna con su altura, posición y fase
  (iluminación real, no solo un icono) para el instante elegido — automático
  (reloj del sistema) o manual (fecha/hora/huso fijos, para "ver el cielo de
  esa noche" sin depender del reloj real). Se puede subir una foto real de la
  Luna (equirectangular) para sustituir la textura genérica generada por
  defecto. Incluye lluvias de meteoros por fecha real (Cuadrántidas,
  Líridas, Eta Acuáridas, Perseidas, Oriónidas, Leónidas, Gemínidas,
  Úrsidas) y un puntero de constelaciones: en el editor, la tecla **L**
  (puntero láser existente) también resalta y nombra la constelación a la
  que apuntas si el cielo está despejado; en el videojuego exportado (que no
  tiene multijugador) la tecla **L** se dedica por completo a esto. Se
  incluye todo en el videojuego exportado.
- **Grillo nocturno**: prefab "🦗 Grillo" en la biblioteca — canto
  sintetizado por código (sin archivo de audio), activo solo de noche, con
  volumen según distancia al jugador.

## Cómo usarlo

Es una aplicación de una sola página. Para el editor y el modo jugador en
solitario no hace falta nada más que abrir `index.html` en un navegador
(local o subido a cualquier hosting estático) — usa
[Three.js](https://threejs.org/) vía CDN (`unpkg.com`) a través de un
`importmap`, así que necesita conexión a internet la primera vez que carga
cada sesión.

Para el **multijugador** (salas, chat, compartir proyecto por enlace) hace
falta servir el sitio desde un servidor con PHP — ver más abajo.

## Estructura del proyecto

```
index.html          Editor + modo jugador + exportador (todo en un archivo)
multi/
  mundo-multi.js     Módulo cliente del multijugador (WebRTC + respaldo por servidor)
  presencia.php       Descubrimiento de peers en una sala (quién está conectado ahora)
  signal.php          Señalización WebRTC (offer/answer/ICE) entre dos navegadores
  chat.php            Retransmisión de chat y respaldo de posición cuando el P2P no conecta
  proyecto.php         Guarda/sirve el proyecto asociado a un código de sala (?sala=), con PIN opcional
test/                Suite de pruebas automatizadas (Node.js) -- ver test/README.md
```

No hace falta Node/npm para usar la aplicación (`index.html` se edita y se
sirve tal cual), pero sí para ejecutar la suite de pruebas de `test/` antes
de publicar cambios: `cd test && npm install && npm test` (motor 3D en
Node vía `three`, y sintaxis de los `.php` vía un intérprete PHP real
compilado a WebAssembly -- no hace falta PHP instalado en la máquina que
ejecuta las pruebas). Ver `test/README.md`.

Los `.php` son ficheros sueltos sin framework ni base de datos
(guardan su estado en archivos JSON efímeros bajo `multi/data/`, que se
crean solos la primera vez que se usan).

## Requisitos

- Cualquier hosting con **PHP 7.4+** para el multijugador y compartir por
  enlace (el editor y el modo jugador en solitario funcionan igual sin
  PHP, sirviendo el HTML de forma estática).
- El directorio `multi/data/` debe ser escribible por PHP (se crea solo,
  pero el proceso de PHP necesita permiso de escritura en `multi/`).
- Revisa `post_max_size`/`upload_max_filesize` en el `php.ini` de tu
  hosting si vas a compartir proyectos con modelos `.glb` o vídeo grandes
  (van en base64 dentro del JSON del proyecto).

## Multijugador (opcional)

El multijugador usa WebRTC punto a punto: dos navegadores en la misma
sala se conectan directamente entre sí (usando un STUN público de Google
para descubrir su IP), y la posición/chat viajan sin pasar por el
servidor. Si esa conexión directa no cuadra (redes muy distintas — datos
móviles + wifi, NAT restrictivo de un centro educativo, etc. — y sin
servidor TURN configurado), el chat y la posición caen automáticamente a
un respaldo más lento vía `chat.php`, así que sigue siendo utilizable
aunque no en tiempo real perfecto.

Para tiempo real fiable entre redes muy distintas hace falta un servidor
TURN (por ejemplo [coturn](https://github.com/coturn/coturn),
autoalojado, o un servicio como Metered/Twilio) — no viene configurado
por defecto.

## Limitaciones conocidas

- El bloqueo de orientación en Modo jugar (móvil) usa la Screen
  Orientation API: no está soportada en Safari/iOS, y algunos navegadores
  exigen pantalla completa para permitirlo. Cuando no está disponible,
  simplemente no se bloquea (sin romper nada).
- El multijugador necesita PHP; no funciona abriendo `index.html`
  directamente desde el disco (`file://`) ni en hosting puramente
  estático.
- El HTML exportado como videojuego independiente no incluye
  multijugador ni el editor — solo la escena jugable.

## Créditos

Construido sobre [Three.js](https://threejs.org/). Un proyecto de
[Infodocencia](https://escenas-3d.infodocencia.net/).

Gran parte del desarrollo de este proyecto — funcionalidades, corrección de
errores y arquitectura del multijugador — se ha hecho con la asistencia de
[Claude](https://claude.com) (Anthropic).

## Licencia

[MIT](LICENSE).
