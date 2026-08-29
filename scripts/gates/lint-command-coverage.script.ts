#!/usr/bin/env bun
/**
 * `bun run lint:command-coverage` — ningún comando sin quien lo ejecute.
 *
 * La auditoría de 2026-08-08 midió que **seis de los doce comandos** no
 * aparecían en ningún test que los lanzara. Predijo que ahí viviría el
 * siguiente bug. Vivían tres, y ninguno era sutil:
 *
 *   · `list` no listaba **nada**, en los 21 frameworks: imprimía cuántos
 *     endpoints había y dejaba la pantalla en blanco.
 *   · `init` **empeoraba** el proyecto que venía a configurar — le
 *     cambiaba el nombre por el del directorio — y cerraba sugiriendo un
 *     comando que en la terminal de quien lo usa no existe.
 *   · `enrich` destruía 8 de 18 requests, también en Laravel, que era el
 *     único framework que soportaba.
 *
 * Los tres estaban a un `bun run` de distancia de verse. Lo que faltaba
 * no era ingenio: era que alguien los ejecutara alguna vez.
 *
 * Este gate exige que cada `packages/cli/commands/*.script.ts` aparezca
 * en algún test que lo **lance de verdad**. No comprueba qué se afirma
 * sobre él —eso es cosa del test— sino que exista quien lo arranque, que
 * es el listón que los tres bugs no pasaban.
 *
 * ## Y que se pueda cargar sin que se ejecute
 *
 * La segunda comprobación salió de exponer `scan` como tool MCP. Cuatro
 * de los doce comandos —`init`, `open`, `summary` y `scan`— llamaban a
 * `process.exit(await main())` **en el cuerpo del módulo**, sin guard.
 * Importar cualquiera de ellos lanzaba el comando y mataba el proceso;
 * en un servidor MCP de vida larga, el servidor entero al cargar el tool.
 *
 * Y encaja con la tesis de este gate: un módulo que se ejecuta al
 * importarse **no se puede probar** salvo por subproceso. La primera
 * comprobación pedía que alguien lo lanzara; esta pide que se pueda.
 *
 * Uso:
 *   bun run lint:command-coverage
 */
import { readFile } from "node:fs/promises";
import { basename, relative } from "node:path";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { collectFiles } from "../helpers/walk.helper.js";

/** Un comando se considera ejercitado si su nombre aparece en un test. */
const TESTS_DIR = fromRoot("tests");
const COMMANDS_DIR = fromRoot("packages", "cli", "commands");

interface IProblem {
  readonly command: string;
  readonly file: string;
}

/**
 * El verbo con el que se invoca cada comando.
 *
 * No coincide con el nombre del fichero, y dar por hecho que sí fue el
 * primer fallo de este gate: `check` vive en `diff.script.ts` y
 * `validate` en `validate-json.script.ts`, así que dos comandos bien
 * probados salían como sin probar. La correspondencia está escrita en el
 * dispatcher, que es su única fuente de verdad — leerla de ahí evita que
 * este gate y el CLI se separen.
 */
async function verbosPorFichero(): Promise<Map<string, string>> {
  const source = await readFile(fromRoot("packages", "cli", "cli.script.ts"), "utf8");
  const mapa = new Map<string, string>();
  const bloque = /^\s{2}([a-z][\w-]*):\s*\{[\s\S]*?import\("\.\/commands\/([\w.-]+)\.js"\)/gm;
  for (const m of source.matchAll(bloque)) {
    const verbo = m[1] ?? "";
    const fichero = m[2] ?? "";
    if (verbo && fichero) mapa.set(fichero, verbo);
  }
  return mapa;
}

async function main(): Promise<number> {
  const verbos = await verbosPorFichero();
  const comandos = (await collectFiles(COMMANDS_DIR, [".script.ts"])).map((f) => {
    const fichero = basename(f, ".ts");
    return {
      file: relative(REPO_ROOT, f),
      // `generate.script.ts` → `generate`
      name: basename(f, ".script.ts"),
      // El verbo del CLI, que puede no coincidir con el fichero.
      verb: verbos.get(fichero) ?? basename(f, ".script.ts"),
    };
  });

  if (comandos.length === 0) {
    console.error("lint:command-coverage — no se encontró ningún comando");
    return 1;
  }

  // Un `process.exit(...)` a nivel de módulo, sin `import.meta.main`
  // delante. Se busca al principio de línea porque dentro del guard va
  // indentado, que es justo la diferencia entre correcto e incorrecto.
  const sinGuard: IProblem[] = [];
  for (const comando of comandos) {
    const fuente = await readFile(fromRoot(comando.file), "utf8");
    if (/^process\.exit\(/m.test(fuente)) {
      sinGuard.push({ command: comando.verb, file: comando.file });
    }
  }

  if (sinGuard.length > 0) {
    console.error(
      `lint:command-coverage — ${sinGuard.length} comando(s) que se ejecutan al importarse:\n`,
    );
    for (const p of sinGuard) console.error(`  ✗ ${p.command}  (${p.file})`);
    console.error(
      "\n  `process.exit(await main())` suelto en el módulo hace que cualquier\n" +
        "  import lance el comando y mate el proceso. En el servidor MCP eso es\n" +
        "  el servidor entero cayéndose al cargar el tool.\n" +
        "\n  Envuélvelo:\n" +
        "\n    if (import.meta.main) {\n" +
        "      process.exit(await main());\n" +
        "    }\n",
    );
    return 1;
  }

  const tests = await collectFiles(TESTS_DIR, [".spec.ts", ".test.ts"]);
  const cuerpo = (await Promise.all(tests.map((f) => readFile(f, "utf8")))).join("\n");

  const problems: IProblem[] = [];
  for (const comando of comandos) {
    // Se busca el nombre del fichero del comando —`generate.script.ts`—
    // o el verbo entre comillas, que es como lo invoca el CLI
    // (`"generate"`). Buscar solo el verbo daría falsos positivos con
    // cualquier palabra suelta.
    const porFichero = cuerpo.includes(`${comando.name}.script.ts`);
    const porVerbo =
      cuerpo.includes(`"${comando.verb}"`) || cuerpo.includes(`'${comando.verb}'`);
    if (!porFichero && !porVerbo) {
      problems.push({ command: comando.verb, file: comando.file });
    }
  }

  if (problems.length > 0) {
    console.error(
      `lint:command-coverage — ${problems.length} comando(s) que ningún test ejecuta:\n`,
    );
    for (const p of problems) console.error(`  ✗ ${p.command}  (${p.file})`);
    console.error(
      "\n  Un comando que nadie lanza es un comando que nadie sabe si funciona.\n" +
        "  De los seis que estaban así, tres estaban rotos: `list` no listaba\n" +
        "  nada, `init` empeoraba el proyecto y `enrich` destruía la colección.\n" +
        "\n  Añade un test que lo ejecute en `tests/cli/`.",
    );
    return 1;
  }

  console.log(
    `lint:command-coverage — ${comandos.length} comandos, todos importables y ejercitados por algún test`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
