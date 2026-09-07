#!/usr/bin/env bun
/**
 * `bun run lint:naming` — que cada fichero diga lo que es.
 *
 * El repo ya tenía una convención de sufijos (`.service.ts`,
 * `.helper.ts`, `.interface.ts`, `.scanner.ts`…) pero nada la
 * comprobaba, así que había ficheros que no la seguían y no había forma
 * de saberlo sin mirar uno a uno: `lint-tool-no-process.ts` era un
 * script sin decirlo, y `sections.ts` no era un script y vivía entre
 * ellos.
 *
 * Un sufijo no es decoración: es lo que deja saber, leyendo el árbol,
 * si un fichero es un contrato, una implementación o un ejecutable —
 * sin abrirlo.
 *
 * Uso:
 *   bun run lint:naming
 */
import { readdir } from "node:fs/promises";
import { join, relative, } from "node:path";
import { REPO_ROOT } from "../helpers/root.helper.js";

/** Qué sufijos admite cada carpeta de código. */
interface INamingRule {
  /** Prefijo de ruta al que aplica, relativo a la raíz. */
  readonly path: string;
  /** Sufijos válidos. Un fichero tiene que acabar en alguno. */
  readonly suffixes: readonly string[];
  /** Nombres exactos permitidos aparte de los sufijos (barrels). */
  readonly exact?: readonly string[];
  /** Qué contiene la carpeta, para el mensaje de error. */
  readonly what: string;
}

const RULES: readonly INamingRule[] = [
  // El proyecto de contratos: `interfaces/` y `constants/` separadas, y
  // el sufijo tiene que coincidir con la carpeta. Una `.constant.ts`
  // dentro de `interfaces/` es justo el desorden que la separación viene
  // a evitar, así que cada una declara solo el suyo.
  {
    path: "packages/contracts/interfaces/",
    what: "interfaces y tipos compartidos",
    suffixes: [".interface.ts", ".d.ts"],
  },
  {
    path: "packages/contracts/constants/",
    what: "constantes compartidas",
    suffixes: [".constant.ts"],
  },
  {
    path: "packages/core/contracts/",
    what: "tipos y constantes compartidas",
    suffixes: [".interface.ts", ".constant.ts", ".d.ts"],
  },
  {
    path: "packages/core/helpers/",
    what: "funciones puras sin estado",
    suffixes: [".helper.ts"],
  },
  {
    path: "packages/core/exporters/",
    what: "un formato de salida por fichero",
    // `.exporter` es un tipo de módulo con significado propio: implementa
    // `IExportTarget` y traduce el catálogo de endpoints a UN formato.
    // Llamarlo `.service` lo escondería entre los quince que ya hay.
    suffixes: [".exporter.ts", ".service.ts"],
  },
  {
    path: "packages/core/",
    what: "el núcleo agnóstico",
    // `.pipeline`, `.orchestrator` y `.adapter` son tipos de módulo con
    // significado propio, igual que `.service`: no son un servicio
    // cualquiera y llamarlos así lo escondería. `.helper.ts` también
    // entra aquí: una función pura no es un servicio (no tiene estado),
    // y `packages/core/helpers/` es solo una de las carpetas donde
    // pueden vivir — `packages/core/discovery/` ya tiene la suya desde
    // r00010 S1.
    suffixes: [".service.ts", ".pipeline.ts", ".orchestrator.ts", ".adapter.ts", ".helper.ts"],
  },
  // Un parser es su propio tipo de módulo: consume código fuente y
  // devuelve un AST. El primero del repo vive en
  // `packages/core/language-frontends/typescript/`, introducido por
  // a00010 S7 — los 6 scanners JS/TS (Express, NestJS, Fastify, Hono,
  // Next.js, tRPC) consumen el AST que produce.
  {
    path: "packages/core/language-frontends/",
    what: "frontends de lenguajes (AST compartido por los scanners)",
    suffixes: [".parser.ts"],
    exact: ["index.ts"],
  },
  {
    // r00013: los extractores de rutas por framework consumen el IR
    // del frontend; no son parsers (no parsean) ni helpers genéricos.
    path: "packages/core/language-frontends/typescript/",
    what: "extractores de rutas sobre el IR del frontend TS",
    suffixes: [".parser.ts", ".helper.ts"],
    exact: ["index.ts"],
  },
  {
    // r00014: la familia del SymbolGraph (grafo, resolver de imports,
    // SymbolId) es infraestructura de grafo — ni servicios ni helpers.
    // El nombre canónico usa guion (`symbol-graph.ts`), así que los
    // sufijos específicos también se declaran con guion.
    path: "packages/core/discovery/",
    what: "servicios y grafos del discovery",
    suffixes: [
      ".service.ts",
      ".pipeline.ts",
      ".orchestrator.ts",
      ".adapter.ts",
      ".helper.ts",
      "-graph.ts",
      "-resolver.ts",
      "-id.ts",
    ],
  },
  {
    path: "packages/frameworks/",
    what: "lo concreto de cada framework",
    // f00012: `.response-inferrer.ts` es vocabulario arquitectónico
    // legítimo (un inferrer por framework, junto a su scanner) — el
    // audit 2026-09-06 §18 lo señalaba como ejemplo de gate demasiado
    // rígido. `response-inferrers.ts` es el barrel de registro.
    suffixes: [
      ".scanner.ts",
      ".service.ts",
      ".helper.ts",
      ".registry.ts",
      ".response-inferrer.ts",
    ],
    exact: ["index.ts", "legacy-discovery.ts", "response-inferrers.ts"],
  },
  {
    // f00012: el dispatcher de inferencia de respuestas no es un
    // servicio (sin estado propio más allá del registry) ni un
    // pipeline; su nombre describe el verbo que hace. Regla más
    // específica que la de `packages/core/` — ruleFor elige por
    // prefijo más largo.
    path: "packages/core/responses/",
    what: "el dispatcher de inferencia de respuestas (agnóstico)",
    suffixes: [".ts"],
    exact: ["infer-responses.ts"],
  },
  {
    path: "packages/cli/",
    what: "el dispatcher y un fichero por comando",
    suffixes: [".script.ts", ".constant.ts"],
  },
  {
    path: "packages/ui/server/",
    what: "el servidor de `expostman ui`: rutas y transporte, separados",
    suffixes: [".service.ts"],
  },
  {
    path: "packages/ui/web/",
    what: "la interfaz, embebida como texto para que el binario la lleve dentro",
    suffixes: [".constant.ts"],
  },
  {
    path: "packages/ui/",
    what: "el asistente interactivo y lo que dibuja en la terminal",
    // `.helper` entra porque el asistente ya no es un solo fichero: la
    // tabla, las barras y el color son funciones puras con sus tests, y
    // llamarlas `.script` diría que se pueden ejecutar, que no es el caso.
    suffixes: [".script.ts", ".helper.ts", ".constant.ts"],
  },
  {
    path: "scripts/",
    what: "tooling del repo (gates y build), no del producto",
    suffixes: [".script.ts", ".constant.ts"],
  },
  {
    path: "scripts/helpers/",
    what: "utilidades compartidas por el tooling",
    suffixes: [".helper.ts"],
  },
  {
    path: "tests/core/",
    what: "tests del núcleo",
    suffixes: [".spec.ts", ".test.ts"],
  },
  {
    path: "tests/frameworks/",
    what: "tests de los scanners",
    suffixes: [".spec.ts", ".test.ts"],
  },
  // El plugin, que hasta ahora el gate no miraba **entera**: son
  // treinta ficheros de la superficie pública MCP, y la regla existía
  // solo en la cabeza de quien los escribió. Se destapó contando las
  // carpetas con `.ts` (65) contra las carpetas con regla (17).
  {
    path: "integrations/delendai/src/lib/tools/",
    what: "un tool MCP por fichero",
    suffixes: [".tool.ts"],
  },
  {
    path: "integrations/delendai/src/lib/helpers/",
    what: "ayudantes internos del plugin",
    suffixes: [".helper.ts"],
  },
  {
    path: "integrations/delendai/src/lib/contracts/interfaces/",
    what: "interfaces del plugin",
    suffixes: [".interface.ts"],
  },
  {
    path: "integrations/delendai/src/lib/contracts/constants/",
    what: "constantes del plugin",
    suffixes: [".constant.ts"],
  },
  // Los dobles compartidos van antes que la regla de tests: `bestMatch`
  // se queda con el prefijo más largo, y este es más específico.
  {
    path: "integrations/delendai/tests/helpers/",
    what: "dobles compartidos entre los tests del plugin",
    suffixes: [".helper.ts", "-context.ts"],
  },
  {
    path: "integrations/delendai/tests/",
    what: "tests del plugin",
    suffixes: [".spec.ts", ".test.ts"],
  },
  // Los idiomas de la interfaz: el servicio que los carga y los
  // catálogos, que son datos y no código.
  {
    path: "packages/ui/i18n/locales/",
    what: "un catálogo de traducciones por idioma",
    suffixes: [".json"],
  },
  {
    path: "packages/ui/i18n/",
    what: "la carga de idiomas",
    suffixes: [".service.ts"],
  },
  {
    path: "packages/ui/settings/",
    what: "los ajustes que persisten entre aperturas",
    suffixes: [".service.ts"],
  },
  { path: "tests/contracts/", what: "tests de los contratos", suffixes: [".spec.ts", ".test.ts"] },
  { path: "tests/cli/", what: "tests del CLI", suffixes: [".spec.ts", ".test.ts"] },
  { path: "tests/e2e/", what: "tests de punta a punta", suffixes: [".spec.ts", ".test.ts"] },
];

/**
 * Carpetas que se saltan enteras.
 *
 * `tests/fixtures` y `tests/smoke-fixtures` son código de ejemplo de
 * OTROS proyectos —un controlador de NestJS, un `urls.py` de Django—, y
 * tienen que llamarse como se llamarían allí. `tests/helpers` son
 * dobles y utilidades transversales, sin un tipo único.
 */
const SKIP_PREFIXES = ["tests/fixtures/", "tests/smoke-fixtures/", "tests/helpers/"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache"]);

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** La regla más específica que aplica a un fichero. */
function ruleFor(relPath: string): INamingRule | undefined {
  let best: INamingRule | undefined;
  for (const rule of RULES) {
    if (!relPath.startsWith(rule.path)) continue;
    if (!best || rule.path.length > best.path.length) best = rule;
  }
  return best;
}

async function main(): Promise<number> {
  const files = await collect(REPO_ROOT);
  const problems: string[] = [];
  let checked = 0;

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;

    const rule = ruleFor(rel);
    if (!rule) continue;
    checked++;

    const name = rel.slice(rel.lastIndexOf("/") + 1);
    if (rule.exact?.includes(name)) continue;
    if (rule.suffixes.some((suffix) => name.endsWith(suffix))) continue;

    problems.push(
      `${rel}\n      ${rule.path} contiene ${rule.what}; los sufijos válidos son ` +
        `${rule.suffixes.join(", ")}` +
        (rule.exact ? ` (o exactamente: ${rule.exact.join(", ")})` : ""),
    );
  }

  if (problems.length > 0) {
    console.error(`lint:naming — ${problems.length} fichero(s) sin sufijo válido:\n`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    return 1;
  }

  console.log(
    `lint:naming — ${checked} ficheros, todos con sufijo válido ` +
      `(${RULES.length} carpetas con regla)`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
