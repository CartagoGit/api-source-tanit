#!/usr/bin/env bun
/**
 * CLI de `@api-source-tanit/cli`.
 *
 * Los comandos se **importan y ejecutan en proceso**. Antes se
 * spawneaba `bun run <script>` resolviendo la ruta del script desde la
 * raíz del paquete, lo que tenía tres problemas:
 *
 *   1. El binario compilado con `bun build --compile` no funcionaba:
 *      dentro del ejecutable no existe `scripts/generate.script.ts`, así
 *      que fallaba con `Module not found`.
 *   2. Exigía tener `bun` en el PATH aunque se distribuyese el binario.
 *   3. Un proceso extra por comando, y ninguna forma de testear el
 *      dispatch sin ejecutar procesos.
 *
 * Cada `*.script.ts` exporta `main(argv)` y solo llama a `process.exit`
 * si es el punto de entrada (`import.meta.main`).
 */
import { isAbsolute, resolve } from "node:path";
import { FRAMEWORK_IDS } from "../contracts/constants/frameworks/framework-ids.constant.js";
import { CLI_VERSION } from "../contracts/constants/cli/cli-version.constant.js";
import { COMMANDS } from "./commands.constant.js";

export { COMMANDS } from "./commands.constant.js";

/**
 * La ayuda se construye al pedirla, no al cargar el módulo.
 *
 * La lista de frameworks sale del registro de scanners, y ese import
 * instancia los diecinueve. Da igual para `--help` —que es lo único que
 * la usa— pero cargarlo en el top level se lo cobraría a todos los demás
 * comandos.
 *
 * Antes la lista estaba escrita a mano en el texto, y decía "Detects 12
 * frameworks" con diecinueve en el registro. Una lista paralela se queda
 * vieja exactamente igual que una constante paralela.
 */
async function buildHelp(): Promise<string> {
  const { describeFormats } = await import(
    "../core/exporters/export-registry.service.js"
  );
  return HELP_TEMPLATE.replace(
    "%FORMATS%",
    ["FORMATS", ...describeFormats().map((f) => `  ${f.format.padEnd(9)} ${f.summary}`)].join(
      "\n",
    ),
  ).replace(
    "%FRAMEWORKS%",
    `Detects ${FRAMEWORK_IDS.length} frameworks automatically:\n` +
      `${wrap([...FRAMEWORK_IDS].sort().join(", "), 72, "  ")}\n` +
      "Use --framework <id> when autodetection can't reach the manifest.",
  );
}

/** Parte un texto en líneas de como mucho `width`, con sangría. */
function wrap(text: string, width: number, indent: string): string {
  const lines: string[] = [];
  let current = indent;
  for (const word of text.split(" ")) {
    if (current.length + word.length > width && current !== indent) {
      lines.push(current);
      current = indent;
    }
    current += current === indent ? word : ` ${word}`;
  }
  lines.push(current);
  return lines.join("\n");
}

const HELP_TEMPLATE = `apisrc — Tanit (generate Postman collections from your API's source)

USAGE
  apisrc                  Interactive wizard (no flags needed)
  apisrc <command> [flags]

COMMANDS
${Object.entries(COMMANDS)
  .map(([name, c]) => `  ${name.padEnd(9)} ${c.summary}`)
  .join("\n")}

COMMON FLAGS
  --project-root <path>   Project to scan. Defaults to the current folder.
  --output-dir <path>     Where to write. Defaults to <project>/tanit.
  --output <file>         Exact path of the collection file.
  --basename <name>       Base name for the generated files.
  --config <path>         ProjectConfig file. Auto-detected when omitted.
  --envs <a,b,c>          Which environments to generate.
  --framework <id>        Skip autodetection and scan as this framework.
  --framework-search-root <sub>   Workspace dir to scan inside a monorepo.
                                  Auto-detected when omitted (f00011 S3).
  --format <a,b,c>        Output formats. Defaults to postman.
  --formats <a,b,c>       Same as --format; the two are mutually exclusive.
  --inspect               Report what was detected; write nothing.
  --allow-empty           Exit 0 even when no endpoint was found.
  --open                  Open Postman when done.
  -i, --interactive       Guided flow: preview, quality summary, formats.
  -h, --help              Show this help.

WATCH FLAGS
  --debounce <ms>         Wait after the last change. Defaults to 300.
  --once                  Generate once and exit (for CI).
  (--format and --framework work here too.)

SYNC FLAGS
  --dry-run               Report the planned sync without writing files.
  (--format, --framework and common project flags work here too.)

PUSH FLAGS
  --api-key <key>         Postman API key. Or set POSTMAN_API_KEY.
  --workspace <id>        Target workspace. Defaults to your personal one.
  --no-environments       Upload the collection only.

ENVIRONMENT VARIABLES
  POSTMAN_PROJECT_ROOT    Same as --project-root.
  POSTMAN_OUTPUT_DIR      Same as --output-dir.
  POSTMAN_API_KEY         Same as --api-key.

EXAMPLES
  apisrc                                  Interactive mode
  apisrc generate                         Scan the current folder
  apisrc generate --project-root ../api   Scan another folder
  apisrc generate --inspect               Preview, write nothing
  apisrc push --api-key pmak-...          Upload to Postman
  apisrc list                             See what was detected
  apisrc generate --framework fastify     Scan as Fastify, no detection
  apisrc watch                            Regenerate on every save
  apisrc generate --format postman,openapi  Postman + an OpenAPI spec

%FORMATS%

%FRAMEWORKS%

Docs: https://github.com/CartagoGit/api-source-tanit#readme
`;

/**
 * Convierte a absolutas las rutas de los flags que reciben una.
 *
 * Los servicios resuelven rutas contra la raíz del proyecto, no contra
 * el cwd, así que una ruta relativa que llegue sin resolver apunta a
 * otro sitio del que el usuario espera.
 */
function absolutizePathFlags(argv: string[]): string[] {
  const out = [...argv];
  for (const flag of ["--project-root", "--config", "--output", "--output-dir"]) {
    const i = out.indexOf(flag);
    const value = i === -1 ? null : out[i + 1];
    if (value && !isAbsolute(value)) out[i + 1] = resolve(value);
  }
  // `--framework-search-root` es un subdir, no una ruta absoluta: se
  // deja pasar tal cual. La validación (sin `/` inicial, sin `..`) vive
  // en `generation.pipeline.ts`.
  return out;
}

export async function run(argv: string[]): Promise<number> {
  const [commandName, ...rest] = argv;

  if (commandName === "-h" || commandName === "--help") {
    console.log(await buildHelp());
    return 0;
  }

  // La versión se imprime y se sale. Es lo que comprueba el smoke del
  // updater: el sidecar que va dentro del instalador tiene que ser
  // de la misma versión que la app que se instala.
  if (commandName === "--version" || commandName === "-v") {
    console.log(CLI_VERSION);
    return 0;
  }

  // Sin argumentos arranca el asistente: es lo que espera quien ejecuta
  // el binario por primera vez sin haber leído la ayuda. `-i` hace lo
  // mismo de forma explícita, para quien sí quiere pedirlo.
  if (!commandName || commandName === "-i" || commandName === "--interactive") {
    const { main: interactiveMain } = await import("../ui/interactive.script.js");
    return interactiveMain(rest);
  }

  const command = COMMANDS[commandName];
  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    console.error(`Available: ${Object.keys(COMMANDS).join(", ")}`);
    return 1;
  }

  const module = await command.load();
  return module.main(absolutizePathFlags(rest));
}

if (import.meta.main) {
  process.exit(await run(process.argv.slice(2)));
}
