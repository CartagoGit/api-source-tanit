/**
 * `KtorScanner` — `IProjectScanner` + `IRouteScanner` for Ktor
 * (Kotlin).
 *
 * Ktor declares routes with a nested DSL:
 *
 *     routing {
 *       route("/api") {
 *         get("/users") { … }
 *         route("/orders") {
 *           post { … }          // no path: inherits from the `route`
 *         }
 *       }
 *     }
 *
 * Two things set it apart from the others:
 *   - Nesting is by **braces**, not by indentation or a chained call,
 *     so the stack has to be kept by counting `{` and `}`.
 *   - A `get { … }` **without a path** is valid and inherits the path
 *     from the surrounding `route`. Ignoring them would leave real
 *     endpoints out.
 *
 * Path params look like `{id}`, which is already the shape the
 * pipeline expects: nothing to normalise.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { collectFiles } from "../../core/helpers/fs-walk.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

/** `get("/users") {` or `get {` — the path is optional. */
const ROUTE_RE = new RegExp(
  String.raw`^\s*(${METHODS.join("|")})\s*(?:\(\s*"([^"]*)"\s*\))?\s*\{`,
);

/** `route("/api") {` — opens a prefix. */
const ROUTE_BLOCK_RE = /^\s*route\s*\(\s*"([^"]*)"\s*\)\s*\{/;

function isKotlinSourceFile(name: string): boolean {
  return name.endsWith(".kt");
}

/** Build files where the Ktor dependency is declared. */
const BUILD_FILES = ["build.gradle.kts", "build.gradle", "pom.xml"];

async function declaresKtor(projectRoot: string): Promise<boolean> {
  for (const file of BUILD_FILES) {
    const path = join(projectRoot, file);
    if (!existsSync(path)) continue;
    try {
      if (/\bktor\b/i.test(await readFile(path, "utf8"))) return true;
    } catch {
      // Unreadable: try the next one.
    }
  }
  return false;
}

export class KtorProjectScanner implements IProjectScanner {
  readonly framework = "ktor" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    if (!(await declaresKtor(projectRoot))) return emptyResult(0);
    const hasSrc = existsSync(join(projectRoot, "src"));
    return withEvidence(hasSrc ? 1 : 0.6, [
      { signal: "build.gradle.kts o build.gradle declara ktor", weight: 0.6 },
      ...(hasSrc ? [{ signal: "src/ presente (convención Ktor)", weight: 0.4, artifact: "src/" }] : []),
    ]);
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

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const files = await collectFiles(effectiveProjectRoot(match), isKotlinSourceFile);
    const routes: ParsedRoute[] = [];

    // Parallel reads with a cap, delivered in input order:
    // the collection has to come out identical every time.
    for await (const { path: file, text: source } of readFilesInOrder(files)) {
      if (!/\brouting\s*\{|\broute\s*\(/.test(source)) continue;
      routes.push(...parseKotlinRouting(source, relative(rawProjectRoot(match), file)));
    }

    return { routes: dedupe(routes) };
  }
}

/**
 * Walks the DSL counting braces.
 *
 * The stack stores the prefix of each open `route("/x") {` and the
 * brace depth at which it was opened, so it can be popped on its `}`.
 */
export function parseKotlinRouting(source: string, sourceFile: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  const lines = source.split("\n");
  const stack: Array<{ prefix: string; depth: number }> = [];

  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Kotlin comments with `//`. A commented-out route is not a route.
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

/** Brace balance of a line, ignoring those inside strings. */
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
