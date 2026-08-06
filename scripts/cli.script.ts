#!/usr/bin/env bun
/**
 * CLI de `@postman-exporter/cli`.
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
    summary: "Genera la colección Postman v2.1.0 y los environments",
    load: () => import("./generate.script.js"),
  },
  check: {
    summary: "Verifica que una colección ya generada sigue sincronizada",
    load: () => import("./diff.script.js"),
  },
  enrich: {
    summary: "Re-enriquece desde discovery (--in-place reemplaza)",
    load: () => import("./enrich.script.js"),
  },
  list: {
    summary: "Lista los endpoints detectados, agrupados por zona",
    load: () => import("./list-endpoints.script.js"),
  },
  stats: {
    summary: "Estadísticas por método y zona",
    load: () => import("./stats.script.js"),
  },
  validate: {
    summary: "Valida el JSON generado contra el schema Postman v2.1.0",
    load: () => import("./validate-json.script.js"),
  },
};

const HELP = `postman-from-routes — genera colecciones Postman desde el código de tu API

Uso:
  postman-from-routes <comando> [flags]

Comandos:
${Object.entries(COMMANDS)
  .map(([name, c]) => `  ${name.padEnd(10)} ${c.summary}`)
  .join("\n")}

Flags comunes:
  --project-root <ruta>  Raíz del proyecto a escanear (auto si no se pasa)
  --config <ruta>        ProjectConfig del host (auto-detectado)
  --basename <nombre>    Nombre base de los ficheros de salida
  --output <ruta>        Ruta completa del JSON de salida
  --output-dir <ruta>    Carpeta de salida
  --envs <a,b,c>         Qué environments generar
  --inspect              (generate) solo informa, no escribe nada
  --open                 (generate) abre Postman al terminar
  -h, --help             Esta ayuda

Ejemplos:
  postman-from-routes generate
  postman-from-routes generate --project-root ./ --basename mi-api
  POSTMAN_PROJECT_ROOT=$(pwd) postman-from-routes check

Documentación: https://github.com/CartagoGit/postman-exporter#readme
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

  if (!commandName || commandName === "-h" || commandName === "--help") {
    console.log(HELP);
    return commandName ? 0 : 1;
  }

  const command = COMMANDS[commandName];
  if (!command) {
    console.error(`Comando desconocido: ${commandName}`);
    console.error(`Disponibles: ${Object.keys(COMMANDS).join(", ")}`);
    return 1;
  }

  const module = await command.load();
  return module.main(absolutizePathFlags(rest));
}

if (import.meta.main) {
  process.exit(await run(process.argv.slice(2)));
}
