/**
 * `KtorScanner` — `IProjectScanner` + `IRouteScanner` para Ktor
 * (Kotlin).
 *
 * Ktor declara las rutas con un DSL anidado:
 *
 *     routing {
 *       route("/api") {
 *         get("/users") { … }
 *         route("/orders") {
 *           post { … }          // sin path: hereda el del `route`
 *         }
 *       }
 *     }
 *
 * Dos cosas lo separan de los demás:
 *   - El anidamiento es por **llaves**, no por indentación ni por una
 *     llamada encadenada, así que hay que llevar la pila contando `{` y
 *     `}`.
 *   - Un `get { … }` **sin path** es válido y hereda el del `route` que
 *     lo envuelve. Ignorarlos dejaría fuera endpoints reales.
 *
 * Los path params van como `{id}`, que ya es la forma que espera el
 * pipeline: no hay que normalizar nada.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { collectFiles } from "../../core/helpers/fs-walk.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

/** `get("/users") {` o `get {` — el path es opcional. */
const ROUTE_RE = new RegExp(
  String.raw`^\s*(${METHODS.join("|")})\s*(?:\(\s*"([^"]*)"\s*\))?\s*\{`,
);

/** `route("/api") {` — abre un prefijo. */
const ROUTE_BLOCK_RE = /^\s*route\s*\(\s*"([^"]*)"\s*\)\s*\{/;

function isKotlinSourceFile(name: string): boolean {
  return name.endsWith(".kt");
}

/** Ficheros de build donde se declara la dependencia de Ktor. */
const BUILD_FILES = ["build.gradle.kts", "build.gradle", "pom.xml"];

async function declaresKtor(projectRoot: string): Promise<boolean> {
  for (const file of BUILD_FILES) {
    const path = join(projectRoot, file);
    if (!existsSync(path)) continue;
    try {
      if (/\bktor\b/i.test(await readFile(path, "utf8"))) return true;
    } catch {
      // Ilegible: se prueba el siguiente.
    }
  }
  return false;
}

export class KtorProjectScanner implements IProjectScanner {
  readonly framework = "ktor" as const;

  async detect(projectRoot: string): Promise<number> {
    if (!(await declaresKtor(projectRoot))) return 0;
    return existsSync(join(projectRoot, "src")) ? 1 : 0.6;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    return { framework: "ktor", projectRoot, artifacts: BUILD_FILES };
  }
}

export class KtorRouteScanner implements IRouteScanner {
  readonly framework = "ktor" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "ktor";
  }

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const files = await collectFiles(match.projectRoot, isKotlinSourceFile);
    const routes: ParsedRoute[] = [];

    // Lectura en paralelo con tope, entregada en el orden de
    // entrada: la colección tiene que salir igual cada vez.
    for await (const { path: file, text: source } of readFilesInOrder(files)) {
      if (!/\brouting\s*\{|\broute\s*\(/.test(source)) continue;
      routes.push(...parseKotlinRouting(source, relative(match.projectRoot, file)));
    }

    return dedupe(routes);
  }
}

/**
 * Recorre el DSL contando llaves.
 *
 * La pila guarda el prefijo de cada `route("/x") {` abierto y a qué
 * profundidad de llaves se abrió, para desapilarlo en su `}`.
 */
export function parseKotlinRouting(source: string, sourceFile: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  const lines = source.split("\n");
  const stack: Array<{ prefix: string; depth: number }> = [];

  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Kotlin comenta con `//`. Una ruta comentada no es una ruta.
    const code = /^\s*\/\//.test(line) ? "" : line;

    const block = ROUTE_BLOCK_RE.exec(code);
    if (block) {
      stack.push({ prefix: block[1] ?? "", depth });
      depth += countBraces(code);
      continue;
    }

    const route = ROUTE_RE.exec(code);
    if (route) {
      const prefix = stack.map((entry) => entry.prefix).join("");
      // Sin path, el endpoint es el propio prefijo del `route`.
      const rawUri = route[2] ?? "";
      routes.push({
        lineNumber: i + 1,
        method: (route[1] ?? "").toUpperCase(),
        uri: joinRoutePath("/", prefix, rawUri),
        rawUri,
        sourceFile,
        prefixChain: stack.map((entry) => entry.prefix),
      });
      depth += countBraces(code);
      continue;
    }

    depth += countBraces(code);
    while (stack.length > 0 && depth <= (stack[stack.length - 1]?.depth ?? 0)) {
      stack.pop();
    }
  }

  return routes;
}

/** Balance de llaves de una línea, ignorando las de dentro de cadenas. */
function countBraces(line: string): number {
  let balance = 0;
  let inString = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i - 1] !== "\\") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") balance++;
    else if (char === "}") balance--;
  }
  return balance;
}

function dedupe(routes: ReadonlyArray<ParsedRoute>): ParsedRoute[] {
  const seen = new Set<string>();
  const out: ParsedRoute[] = [];
  for (const route of routes) {
    const key = `${route.method} ${route.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(route);
  }
  return out;
}
