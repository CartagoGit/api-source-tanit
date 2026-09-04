#!/usr/bin/env bun
/**
 * `bun run lint:contracts` — los tipos y las constantes viven en un solo
 * sitio.
 *
 * Un tipo declarado al lado de la función que lo estrenó obliga a
 * importar esa función para usarlo. Suena inocuo y no lo es: se midió en
 * tres sitios del propio repositorio.
 *
 *   · La interfaz web importaba `IProjectSummary` de
 *     `core/discovery/summary.service` — o sea que para **tipar** un
 *     resumen se llevaba el pipeline entero por delante.
 *   · El plugin MCP importaba el catálogo de nombres de
 *     `frameworks/index`, que arrastra los veintiún scanners con sus
 *     parsers de PHP, Go, Java, Python y Rust, para declarar un `z.enum`
 *     de veintiún strings.
 *   · Y `supportedFormats()` metía los cinco exportadores en el grafo
 *     por la misma razón.
 *
 * El efecto de fondo es peor que el peso: cuando el tipo vive en la
 * implementación, nada impide que se dupliquen. `SummaryOutputSchema`
 * reescribía con zod la forma de `IProjectSummary`, las dos se
 * separaron, y el esquema declaraba 6 campos mientras el handler
 * devolvía 18. Nadie podía notarlo porque no había nada que los
 * confrontara.
 *
 * ## La regla
 *
 * Toda `export interface`, `export type` y constante exportada vive en
 * una carpeta `contracts/`, con `interfaces/` y `constants/` dentro. El
 * monorepo tiene la suya en `packages/contracts/`; el plugin, que es un
 * paquete aparte y se publica solo, tiene la suya.
 *
 * ## Qué NO es una constante, aunque use `const`
 *
 * Un **asset**: un documento que el programa sirve o escribe tal cual.
 * `UI_HTML` es la página entera de la interfaz web, con su CSS y su JS
 * dentro. Meterla en un proyecto que declara «sin implementación» sería
 * cumplir la letra rompiendo el motivo. Va declarada abajo, con nombre.
 *
 * El criterio para que algo sea contrato es que **más de un módulo
 * dependa de su valor concreto**. `AUTH_TOKEN_VARIABLE` lo cumple: lo
 * comparten el script del login, el bloque `auth` y cada cabecera, y si
 * bailara entre ellos la colección dejaría de autenticar sin que nada
 * fallara.
 *
 * Uso:
 *   bun run lint:contracts
 */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { collectFiles } from "../helpers/walk.helper.js";

/** Un sitio que puede declarar tipos o constantes fuera de contratos. */
interface IException {
  /** Ruta relativa a la raíz. Si acaba en `/`, cubre la carpeta. */
  readonly path: string;
  readonly why: string;
}

const EXCEPTIONS: readonly IException[] = [
  {
    path: "packages/frameworks/framework.registry.ts",
    why:
      "`DEFAULT_REGISTRY` no es un valor: es un grafo de scanners **ya " +
      "instanciados** (`new GraphQlProjectScanner()`…). Es la raíz de " +
      "composición del catálogo, y meterla en un proyecto sin " +
      "implementación arrastraría los veintiún scanners justo donde no " +
      "puede haberlos. El catálogo de nombres sí está en contratos, que " +
      "es lo que la gente necesita leer.",
  },
  {
    path: "packages/ui/web/theme.constant.ts",
    why:
      "`UI_STYLES` es la hoja de estilos, un asset que la página sirve tal " +
      "cual. Lo que sí es contrato —los modos y los nombres de las " +
      "variables, que comparten los ajustes, el servidor y esta hoja— vive " +
      "en `contracts/constants/cli/theme.constant.ts`.",
  },
  {
    path: "packages/ui/web/index.html.constant.ts",
    why:
      "Es un asset, no una constante: la página entera de la interfaz web, " +
      "con su CSS y su JS. Meterla en un proyecto que declara «sin " +
      "implementación» sería cumplir la letra rompiendo el motivo.",
  },
];

/**
 * Las carpetas de contratos del repo.
 *
 * Son dos porque el plugin es un paquete independiente que se publica
 * solo: sus esquemas zod son **código ejecutable** y no caben en una
 * sección que promete no tener implementación.
 */
const CONTRACT_DIRS = [
  "packages/contracts/",
  "packages/plugins/delendai_expostman/src/lib/contracts/",
] as const;

/** Lo que se busca: un tipo o una constante exportados. */
const TIPO = /^export\s+(?:interface|type)\s+(\w+)/gm;
const CONSTANTE = /^export\s+const\s+([A-Z][A-Z0-9_]*)\s*[:=]/gm;

/**
 * Quita comentarios y literales de plantilla.
 *
 * Lo segundo hace falta de verdad: `init.script.ts` **genera** un fichero
 * de configuración para el proyecto anfitrión, y ese texto contiene un
 * `export const ALL_ENDPOINTS`. Es código que se escribe en disco, no
 * código de este repositorio, y contarlo daba un falso positivo.
 */
function limpiar(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`(?:[^`\\]|\\[\s\S])*`/g, "``");
}

function esContrato(rel: string): boolean {
  return CONTRACT_DIRS.some((dir) => rel.startsWith(dir));
}

function excepcionPara(rel: string): IException | undefined {
  return EXCEPTIONS.find((e) =>
    e.path.endsWith("/") ? rel.startsWith(e.path) : rel === e.path,
  );
}

interface IProblem {
  readonly file: string;
  readonly kind: "tipo" | "constante";
  readonly name: string;
}

async function main(): Promise<number> {
  const files = await collectFiles(fromRoot("packages"), [".ts"]);

  const problems: IProblem[] = [];
  const usadas = new Set<string>();
  let declarados = 0;

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    // Los tests del plugin viven dentro del paquete pero son tooling
    // suyo, no superficie publicada.
    if (rel.includes("/tests/")) continue;

    const source = limpiar(await readFile(file, "utf8"));
    const tipos = [...source.matchAll(TIPO)].map((m) => m[1] ?? "");
    const constantes = [...source.matchAll(CONSTANTE)].map((m) => m[1] ?? "");
    if (tipos.length === 0 && constantes.length === 0) continue;

    if (esContrato(rel)) {
      declarados += tipos.length + constantes.length;
      continue;
    }

    const excepcion = excepcionPara(rel);
    if (excepcion) {
      usadas.add(excepcion.path);
      continue;
    }

    for (const name of tipos) problems.push({ file: rel, kind: "tipo", name });
    for (const name of constantes) {
      problems.push({ file: rel, kind: "constante", name });
    }
  }

  if (problems.length > 0) {
    console.error(
      `lint:contracts — ${problems.length} declaración(es) fuera de contratos:\n`,
    );
    for (const p of problems) {
      console.error(`  ✗ ${p.file}\n      ${p.kind} \`${p.name}\``);
    }
    console.error(
      "\n  Un tipo declarado al lado de la función que lo estrenó obliga a\n" +
        "  importar esa función para usarlo. La interfaz web se llevaba el\n" +
        "  pipeline entero por delante solo para tipar un resumen.\n" +
        "\n  Muévelo a `packages/contracts/interfaces/` o `constants/`, según\n" +
        "  lo que sea. Si de verdad no es un contrato —un asset, un documento\n" +
        "  que el programa sirve tal cual— decláralo en `EXCEPTIONS` con su\n" +
        "  motivo.",
    );
    return 1;
  }

  const muertas = EXCEPTIONS.filter((e) => !usadas.has(e.path));
  if (muertas.length > 0) {
    console.error(
      `lint:contracts — ${muertas.length} excepción(es) que ya no hacen falta:\n`,
    );
    for (const e of muertas) console.error(`  ✗ ${e.path}`);
    console.error(
      "\n  Ya no declaran nada fuera de contratos. Bórralas para que la lista\n" +
        "  no autorice lo que nadie ha vuelto a revisar.",
    );
    return 1;
  }

  console.log(
    `lint:contracts — ${declarados} tipos y constantes, todos en contratos ` +
      `(${EXCEPTIONS.length} excepción declarada)`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}

/** La lista, para que un test pueda comprobar sus invariantes. */
export { EXCEPTIONS, type IException };
