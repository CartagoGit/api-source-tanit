#!/usr/bin/env bun
/**
 * CLI de `@export-to-postman/cli`.
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

/** Un comando del CLI: su descripción y cómo cargarlo. */
interface ICommand {
  readonly summary: string;
  load(): Promise<{ main(argv: string[]): Promise<number> }>;
}

/**
 * Los `import()` son literales estáticos a propósito: `bun build
 * --compile` necesita verlos para incluir los módulos en el binario. Un
 * `import(variable)` los dejaría fuera.
 */
const COMMANDS: Record<string, ICommand> = {
  generate: {
    summary: "Generate the Postman v2.1.0 collection and its environments",
    load: () => import("./commands/generate.script.js"),
  },
  check: {
    summary: "Check that an already generated collection is still in sync",
    load: () => import("./commands/diff.script.js"),
  },
  enrich: {
    summary: "Re-enrich an existing collection (--in-place overwrites it)",
    load: () => import("./commands/enrich.script.js"),
  },
  list: {
    summary: "List the detected endpoints, grouped by folder",
    load: () => import("./commands/list-endpoints.script.js"),
  },
  stats: {
    summary: "Endpoint counts per HTTP method and folder",
    load: () => import("./commands/stats.script.js"),
  },
  validate: {
    summary: "Validate a generated collection against the Postman v2.1.0 schema",
    load: () => import("./commands/validate-json.script.js"),
  },
  push: {
    summary: "Upload the collection straight to your Postman workspace",
    load: () => import("./commands/push.script.js"),
  },
};

const HELP = `expostman — Export to Postman (generate Postman collections from your API's source)

USAGE
  expostman                  Interactive wizard (no flags needed)
  expostman <command> [flags]

COMMANDS
${Object.entries(COMMANDS)
  .map(([name, c]) => `  ${name.padEnd(9)} ${c.summary}`)
  .join("\n")}

COMMON FLAGS
  --project-root <path>   Project to scan. Defaults to the current folder.
  --output-dir <path>     Where to write. Defaults to <project>/build.
  --output <file>         Exact path of the collection file.
  --basename <name>       Base name for the generated files.
  --config <path>         ProjectConfig file. Auto-detected when omitted.
  --envs <a,b,c>          Which environments to generate.
  --inspect               Report what was detected; write nothing.
  --open                  Open Postman when done.
  -h, --help              Show this help.

PUSH FLAGS
  --api-key <key>         Postman API key. Or set POSTMAN_API_KEY.
  --workspace <id>        Target workspace. Defaults to your personal one.
  --no-environments       Upload the collection only.

ENVIRONMENT VARIABLES
  POSTMAN_PROJECT_ROOT    Same as --project-root.
  POSTMAN_OUTPUT_DIR      Same as --output-dir.
  POSTMAN_API_KEY         Same as --api-key.

EXAMPLES
  expostman                                  Interactive mode
  expostman generate                         Scan the current folder
  expostman generate --project-root ../api   Scan another folder
  expostman generate --inspect               Preview, write nothing
  expostman push --api-key pmak-...          Upload to Postman
  expostman list                             See what was detected

Detects 12 frameworks automatically: Laravel, Symfony, Express, NestJS,
Next.js, FastAPI, Flask, Django, Gin, Spring Boot, ASP.NET Core and OpenAPI.

Docs: https://github.com/CartagoGit/export-to-postman#readme
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
  return out;
}

export async function run(argv: string[]): Promise<number> {
  const [commandName, ...rest] = argv;

  if (commandName === "-h" || commandName === "--help") {
    console.log(HELP);
    return 0;
  }

  // Sin argumentos arranca el asistente: es lo que espera quien ejecuta
  // el binario por primera vez sin haber leído la ayuda.
  if (!commandName) {
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
