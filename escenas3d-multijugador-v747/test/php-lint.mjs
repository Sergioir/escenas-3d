// Comprueba que los 4 ficheros PHP del multijugador (multi/*.php) tienen sintaxis válida, usando un
// intérprete PHP real compilado a WebAssembly (@php-wasm/node -- el mismo motor que usa WordPress
// Playground) -- así no hace falta tener PHP instalado en la máquina para verificarlo antes de subir
// a GitHub. Comprobación de sintaxis pura (equivalente a "php -l"): se compila cada fichero dentro de
// una función anónima que nunca se llama, así que un error de sintaxis se detecta pero el código
// (que espera $_POST, cabeceras, sesión, etc.) nunca llega a ejecutarse de verdad.
import { PHP } from "@php-wasm/universal";
import { loadNodeRuntime } from "@php-wasm/node";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MULTI_DIR = path.resolve(__dirname, "..", "multi");

let hadFailure = false;
function fail(msg) { console.error("FALLO: " + msg); hadFailure = true; }
function ok(msg) { console.log("OK: " + msg); }

const php = new PHP(await loadNodeRuntime("8.1", { emscriptenOptions: { processId: process.pid } }));

const files = fs.readdirSync(MULTI_DIR).filter((f) => f.endsWith(".php"));
if (!files.length) { fail("No se encontró ningún .php en " + MULTI_DIR); process.exit(1); }

for (const f of files) {
  const content = fs.readFileSync(path.join(MULTI_DIR, f), "utf-8");
  const vpath = "/lint_" + f;
  php.writeFile(vpath, content);
  const checkCode = `<?php
    $code = file_get_contents('${vpath}');
    $body = preg_replace('/^\\s*<\\?php/', '', $code);
    try {
      eval('return function(){ ' . $body . ' };');
      echo "SYNTAX_OK";
    } catch (\\Throwable $e) {
      echo "SYNTAX_ERROR: " . $e->getMessage() . " (linea " . $e->getLine() . ")";
    }
  `;
  const out = await php.run({ code: checkCode });
  const text = (out.text || "").trim();
  if (text.startsWith("SYNTAX_OK")) ok(f + ": sintaxis correcta.");
  else fail(f + ": " + text);
}

process.exit(hadFailure ? 1 : 0);
