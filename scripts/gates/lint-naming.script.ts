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
  {
    path: "projects/core/contracts/",
    what: "tipos y constantes compartidas",
    suffixes: [".interface.ts", ".constant.ts", ".d.ts"],
  },
  {
    path: "projects/core/helpers/",
    what: "funciones puras sin estado",
    suffixes: [".helper.ts"],
  },
  {
    path: "projects/core/exporters/",
    what: "un formato de salida por fichero",
    // `.exporter` es un tipo de módulo con significado propio: implementa
    // `IExportTarget` y traduce el catálogo de endpoints a UN formato.
    // Llamarlo `.service` lo escondería entre los quince que ya hay.
    suffixes: [".exporter.ts", ".service.ts"],
  },
  {
    path: "projects/core/",
    what: "el núcleo agnóstico",
    // `.pipeline`, `.orchestrator` y `.adapter` son tipos de módulo con
    // significado propio, igual que `.service`: no son un servicio
    // cualquiera y llamarlos así lo escondería.
    suffixes: [".service.ts", ".pipeline.ts", ".orchestrator.ts", ".adapter.ts"],
  },
  {
    path: "projects/frameworks/",
    what: "lo concreto de cada framework",
    suffixes: [".scanner.ts", ".service.ts", ".helper.ts", ".registry.ts"],
    exact: ["index.ts", "legacy-discovery.ts"],
  },
  {
    path: "projects/cli/",
    what: "el dispatcher y un fichero por comando",
    suffixes: [".script.ts", ".constant.ts"],
  },
  {
    path: "projects/ui/",
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
