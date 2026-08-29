#!/usr/bin/env bun
/**
 * `bun run lint:project-context` — quién puede preguntarle al singleton.
 *
 * `paths.service` resuelve la raíz del proyecto **una vez por proceso** y
 * la cachea. Para el CLI está bien: un proceso por proyecto. Para
 * cualquier consumidor de vida larga —el servidor MCP, la interfaz web—
 * es una trampa, y ya mordió tres veces:
 *
 *   · `generate` desde la UI escribía dentro de este repositorio en vez
 *     de en el proyecto pedido.
 *   · Analizar el proyecto A y luego el B devolvía las rutas de A.
 *   · Y para taparlo hubo que serializar con una cola global, que a su
 *     vez escondía que los scanners se pisaban los regex compartidos
 *     (r00005 S2).
 *
 * La cura de fondo es que el contexto entre **como argumento**. Este
 * gate no la impone de golpe —quedan capas por migrar— pero sí congela
 * el avance: cada sitio que hoy lee el singleton está declarado abajo
 * **con su motivo**, y uno nuevo no compila el gate.
 *
 * ## Las tres categorías, y por qué no son la misma
 *
 * - `entrypoint`: el borde del sistema. Un comando del CLI resuelve la
 *   raíz de los flags porque es su trabajo; ahí el estado global no
 *   puede confundirse con nada porque solo hay un proyecto por proceso.
 * - `facade`: el propio `paths.service` y el resolutor explícito. Son
 *   los que *implementan* la resolución; prohibírselo no tendría sentido.
 * - `debt`: lo que debería recibir contexto y todavía no. Cada uno dice
 *   qué hace falta para quitarlo. Esta lista solo puede encoger.
 *
 * Una excepción que ya no lee nada **también falla**: una lista de
 * permisos que se queda vieja acaba autorizando lo que nadie revisó.
 *
 * Uso:
 *   bun run lint:project-context
 */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { collectFiles } from "../helpers/walk.helper.js";

/** Un sitio autorizado a leer el estado global de rutas. */
interface IException {
  /** Ruta relativa a la raíz. Si acaba en `/`, cubre la carpeta. */
  readonly path: string;
  readonly kind: "entrypoint" | "facade" | "debt";
  /** Por qué es legítimo, o qué hace falta para dejar de serlo. */
  readonly why: string;
}

const EXCEPTIONS: readonly IException[] = [
  // --- El borde del sistema ------------------------------------------------
  {
    path: "packages/cli/",
    kind: "entrypoint",
    why:
      "Un comando resuelve la raíz de sus flags porque es su trabajo, y el " +
      "CLI es un proceso por proyecto: el estado global no puede confundirse " +
      "con el de nadie.",
  },
  {
    path: "packages/ui/interactive.script.ts",
    kind: "entrypoint",
    why: "El asistente interactivo es un entrypoint, igual que un comando.",
  },

  // --- Quienes implementan la resolución -----------------------------------
  {
    path: "packages/core/discovery/paths.service.ts",
    kind: "facade",
    why: "Es el singleton. Prohibirle leerse a sí mismo no tendría sentido.",
  },
  {
    path: "packages/core/discovery/project-context.service.ts",
    kind: "facade",
    why:
      "Es la alternativa SIN estado: lee `POSTMAN_PROJECT_ROOT` del `env` que " +
      "le inyectan, no del global, y devuelve un objeto nuevo por llamada.",
  },
  {
    path: "packages/core/helpers/resolve-root.helper.ts",
    kind: "facade",
    why:
      "El resolutor único de `--project-root` para los entrypoints (r00005 S1). " +
      "Existe justamente para que no lo haga cada comando a su manera.",
  },

  // --- Deuda declarada, que solo puede encoger -----------------------------
];

/** Lo que cuenta como leer el estado global. */
const IMPORTA_PATHS = /from\s+["'][^"']*paths\.service(?:\.js)?["']/;
const VARIABLE_ENV = /POSTMAN_PROJECT_ROOT/;

/** Quita comentarios: mencionar la variable al explicarla no es leerla. */
function sinComentarios(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function excepcionPara(rel: string): IException | undefined {
  return EXCEPTIONS.find((e) =>
    e.path.endsWith("/") ? rel.startsWith(e.path) : rel === e.path,
  );
}

async function main(): Promise<number> {
  const files = await collectFiles(fromRoot("packages"), [".ts"]);

  const infractores: string[] = [];
  const usadas = new Set<string>();
  let lectores = 0;

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    const source = sinComentarios(await readFile(file, "utf8"));
    if (!IMPORTA_PATHS.test(source) && !VARIABLE_ENV.test(source)) continue;
    lectores++;

    const excepcion = excepcionPara(rel);
    if (excepcion) {
      usadas.add(excepcion.path);
      continue;
    }
    infractores.push(rel);
  }

  if (infractores.length > 0) {
    console.error(
      `lint:project-context — ${infractores.length} fichero(s) leen el estado global sin permiso:\n`,
    );
    for (const rel of infractores) console.error(`  ✗ ${rel}`);
    console.error(
      "\n  `paths.service` cachea la raíz una vez por proceso. Fuera de un\n" +
        "  entrypoint eso es una trampa: el servidor MCP analizaba el proyecto\n" +
        "  A y devolvía las rutas de B.\n" +
        "\n  Recibe `IProjectContext` como argumento y úsalo. Si de verdad es un\n" +
        "  entrypoint, decláralo en `EXCEPTIONS` con su motivo — declarado, no\n" +
        "  inferido.",
    );
    return 1;
  }

  // Una excepción que ya no protege nada es una puerta abierta que nadie
  // vigila. Al migrar una capa hay que borrar su línea, y esto lo exige.
  const muertas = EXCEPTIONS.filter((e) => !usadas.has(e.path));
  if (muertas.length > 0) {
    console.error(
      `lint:project-context — ${muertas.length} excepción(es) que ya no hacen falta:\n`,
    );
    for (const e of muertas) console.error(`  ✗ ${e.path}  (${e.kind})`);
    console.error(
      "\n  Ninguno de sus ficheros lee ya el estado global: la deuda está\n" +
        "  pagada. Bórralas de `EXCEPTIONS` para que la lista no autorice\n" +
        "  lo que nadie ha vuelto a revisar.",
    );
    return 1;
  }

  const deuda = EXCEPTIONS.filter((e) => e.kind === "debt").length;
  console.log(
    `lint:project-context — ${lectores} ficheros leen rutas, todos declarados ` +
      `(${EXCEPTIONS.length - deuda} legítimos, ${deuda} de deuda por migrar)`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}

/** La lista, para que un test pueda comprobar sus invariantes. */
export { EXCEPTIONS, type IException };
