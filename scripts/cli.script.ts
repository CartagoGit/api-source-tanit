#!/usr/bin/env bun
/**
 * CLI entrypoint portable del paquete `@postman-exporter/cli`.
 *
 * Resolución de la raíz del paquete (agnóstica del modo de instalación):
 *   1. Si se ejecuta con `bunx`/`npx`, busca `contract/postman.constant.ts`
 *      subiendo desde `import.meta.dir` hasta dar con la raíz.
 *   2. En ejecución directa desde el repo (`bun run`), resuelve igual.
 *   3. Como último recurso, usa el cwd del usuario.
 *
 * Comandos:
 *   generate [--project-root <p>] [--config <p>] [--output <p>] [--basename <name>]
 *   check    [--project-root <p>] [--config <p>]
 *   enrich   [--project-root <p>] [--config <p>] [--in-place]
 *   list     [--project-root <p>] [--config <p>]
 *   stats    [--project-root <p>] [--config <p>]
 *   validate [--project-root <p>] [--config <p>]
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const [, , command, ...args] = process.argv;

const SCRIPTS: Record<string, string> = {
  generate: "scripts/generate.script.ts",
  check: "scripts/diff.script.ts",
  enrich: "scripts/enrich.script.ts",
  list: "scripts/list-endpoints.script.ts",
  stats: "scripts/stats.script.ts",
  validate: "scripts/validate-json.script.ts",
};

const HELP = `postman-from-routes — Generador Postman desde rutas Laravel

Uso:
  postman-from-routes <command> [flags]

Comandos:
  generate   Genera la colección Postman v2.1.0
  check      Verifica que la colección está sincronizada con las rutas
  enrich     Re-enriquece desde discovery (--in-place reemplaza)
  list       Lista endpoints agrupados por zona
  stats      Estadísticas por método y zona
  validate   Valida el JSON generado contra Postman v2.1.0

Flags comunes:
  --project-root <path>  Raíz del proyecto Laravel (auto si no se pasa)
  --config <path>        Archivo ProjectConfig del host (auto: examples/<proyecto>/config.constant.ts)
  --basename <name>      Nombre base del JSON de salida
  --output <path>        Ruta completa del JSON de salida (override absoluto)
  --in-place             (enrich) reemplaza la colección principal
  -h, --help             Esta ayuda

Ejemplos:
  postman-from-routes generate
  postman-from-routes generate --project-root ./ --basename mi-api
  POSTMAN_PROJECT_ROOT=$(pwd) postman-from-routes check
`;

if (!command || command === "-h" || command === "--help") {
  console.log(HELP);
  process.exit(command ? 0 : 1);
}

const script = SCRIPTS[command];
if (!script) {
  console.error(`Comando desconocido: ${command}`);
  console.error(`Disponibles: ${Object.keys(SCRIPTS).join(", ")}`);
  process.exit(1);
}

function dirnameUp(p: string, steps: number): string {
  let cur = p;
  for (let i = 0; i < steps; i++) {
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return cur;
}

function findPackageRoot(start: string): string | null {
  let cur = resolve(start);
  for (let i = 0; i < 16; i++) {
    if (
      existsSync(join(cur, "contract", "postman.constant.ts")) &&
      existsSync(join(cur, "package.json"))
    ) {
      return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

const start = (import.meta as { dir?: string }).dir ?? process.cwd();
const packageRoot = findPackageRoot(start) ?? dirnameUp(start, 2);
const scriptAbs = join(packageRoot, script);

// Reenvío de flags útiles a través de env (los scripts leen process.env directamente).
const flagProjectRoot = getFlag(args, "--project-root");
if (flagProjectRoot && !isAbsolute(flagProjectRoot)) {
  args[args.indexOf("--project-root") + 1] = resolve(flagProjectRoot);
}
const flagConfig = getFlag(args, "--config");
if (flagConfig && !isAbsolute(flagConfig)) {
  args[args.indexOf("--config") + 1] = resolve(flagConfig);
}

const child = spawn("bun", ["run", scriptAbs, ...args], {
  stdio: "inherit",
  cwd: packageRoot,
});
child.on("exit", (code: number | null) => process.exit(code ?? 1));

function getFlag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? null;
}
