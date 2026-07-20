# Pruebas automatizadas — Don Claude 3D

Suite de regresión en Node.js para el motor (editor + juego exportado, todo en `index.html`) y para
el backend PHP del multijugador (`multi/*.php`). Pensada para pillar, antes de subir una versión a
GitHub, el tipo de fallo que más veces ha roto esta app: código que se implementó (o se corrigió) en
una de las dos copias del motor — la del editor en vivo y la del juego exportado — pero no en la otra.

## Cómo ejecutarla

```sh
cd test
npm install   # una vez -- instala three (motor 3D) y @php-wasm/node (PHP real vía WebAssembly)
npm test      # o: node run-all.mjs
```

No hace falta ni navegador ni PHP instalado en la máquina: el motor se ejecuta con el paquete `three`
tal cual corre en un navegador (sin WebGL real — no comprobamos píxeles, sino posiciones, colisiones,
disparos, paneles...), y el PHP corre en un intérprete real compilado a WebAssembly.

## Qué comprueba cada fichero

- **`syntax-and-parity.mjs`** — Sintaxis válida del editor en vivo Y del juego exportado (este último
  generado de verdad ejecutando `buildStandaloneGameHtml()`/`buildStandaloneGameRuntimeSrc()` tal
  como están HOY en `index.html`, no una copia aparte). Además comprueba que ~65 funciones del motor
  consideradas críticas (física, disparo, interactivo, bóveda nocturna, meteoros, grillo, carga de
  modelos...) existen con el mismo nombre en las dos copias — ver `critical-runtime-functions.json`.

- **`engine-functional.mjs`** — Ejecuta el CÓDIGO REAL del juego exportado (extraído de `index.html`,
  no reimplementado) sobre un proyecto de prueba sintético, y comprueba comportamientos concretos:
  - Un cartel interactivo con texto vacío ejecuta su acción sin abrir panel ni bloquear el juego.
  - Un cartel con texto SÍ abre el panel (bloquea) y se cierra con E/Esc.
  - Disparar (F) a un objetivo en línea recta lo detecta e inicia su acción (huida/animación).
  - Un objetivo totalmente desvanecido (opacidad 0) deja de ser alcanzable por el disparo (regresión
    del bug del "fantasma disparable").

- **`gltf-scale-regression.mjs`** — Construye un esqueleto sintético con una "bind pose" aplastada a
  propósito (el mismo caso raro que sufría `CesiumMan.glb`) y comprueba que `computeModelBounds()`
  calcula el tamaño real a partir de la animación, no de la pose en reposo — regresión del bug por el
  que un personaje con esqueleto se exportaba minúsculo/descolocado y no se podía ni ver ni acertar.

- **`php-lint.mjs`** — Sintaxis válida de los 4 `.php` del multijugador, con un intérprete PHP real
  (WebAssembly), sin ejecutar su lógica (que espera peticiones HTTP reales, sesión, ficheros de datos).

## Limitaciones (a tener en cuenta)

- No hay comprobación de renderizado real (píxeles, WebGL) ni de audio.
- No hay prueba funcional de extremo a extremo del backend PHP (peticiones HTTP reales, ficheros de
  datos bajo `multi/data/`, WebRTC) — solo se valida que el código PHP compila sin errores de sintaxis.
  Para probar el multijugador de verdad hace falta un hosting con PHP real (ver el README principal).
- El chequeo de "paridad de funciones" es una lista curada (`critical-runtime-functions.json`) de lo
  que se considera crítico para el juego jugable, no todas las funciones del editor — el resto de
  funciones del editor (paneles, gizmos, undo, portapapeles...) se listan solo informativamente al
  final de `syntax-and-parity.mjs`. Si se añade una función de motor/jugabilidad nueva que deba vivir
  en las dos copias, conviene añadirla también a esa lista.
