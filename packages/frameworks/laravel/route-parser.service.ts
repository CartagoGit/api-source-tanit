/**
 * Laravel route-parsing service.
 *
 * Reads `routes/*.php` line by line while keeping a stack of active
 * prefixes (`Route::prefix('xxx')->group(...)`). Ignores commented
 * lines so commented-out routes like the old `batches` index aren't
 * counted.
 *
 * For files whose prefix is applied externally (loaded with
 * `Route::prefix('api/<x>')` in their ServiceProvider) an explicit
 * initial prefix is passed via FILE_PREFIXES. This covers the typical
 * Laravel project with several `mapXxxRoutes()` methods that add
 * different prefixes depending on the file.
 *
 * Returns each route with:
 *   - `uri`: full URI with the prefix resolved.
 *   - `prefixChain`: list of active prefixes when the route was
 *     declared.
 *
 * It also exports helpers to compute the top-level group
 * (`topGroupFor`) and a readable name (`prettyGroupName`) from the
 * URI. This lets folders be generated automatically without
 * hardcoding.
 */
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { fromProjectRoot, projectDirs } from "../../core/discovery/project-context.service.js";
import { readFile } from "node:fs/promises";
import type { ParsedRoute } from "../../contracts/interfaces/frameworks/scanners.interface.js";

const ROUTE_METHOD_RE = /Route::(get|post|put|delete|patch)\s*\(\s*['"]([^'"]*)['"]/i;
const PREFIX_RE = /Route::prefix\(\s*['"]([^'"]+)['"]/;
/** Captura `[FooController::class, 'action']` o `[FooController::class,"action"]`. */
const ACTION_RE =
  /\[\s*([A-Za-z0-9_]+)::class\s*,\s*['"]([A-Za-z0-9_]+)['"]\s*\]/;
/** `use App\Http\Controllers\Foo\Bar as Alias;` */
const USE_RE =
  /use\s+([A-Za-z0-9_\\]+)\s*(?:as\s+([A-Za-z0-9_]+))?\s*;/g;

/** Strips single-line and multi-line comments so commented-out routes aren't counted. */
export function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return out;
}

/** Parses a Laravel route file and returns the discovered routes. */
/**
 * `context` is mandatory. It used to be optional for compatibility:
 * without it we fell back to the now-removed `paths.service` singleton
 * (r00010 S2, 2026-09-03), which resolved the root once per process.
 * Always pass it from new code (see p00017).
 */
export async function parseRoutesFile(
  relPath: string,
  initialPrefix: string[] = [],
  context: IProjectContext,
): Promise<ParsedRoute[]> {
  const abs = fromProjectRoot(context, relPath);
  const raw = await readFile(abs, "utf8");
  const text = stripComments(raw);

  // alias → FQCN map built from the file's `use` statements.
  const imports = new Map<string, string>();
  let um: RegExpExecArray | null;
  const useRe = ownRegex(USE_RE);
  while ((um = useRe.exec(text)) !== null) {
    const fqcn = um[1];
    if (!fqcn) continue;
    const short = fqcn.split("\\").pop() ?? fqcn;
    const alias = um[2] ?? short;
    imports.set(alias, fqcn);
    // We also index by the short name in case there is no alias.
    if (!imports.has(short)) imports.set(short, fqcn);
  }

  const prefixStack: string[] = [...initialPrefix];
  const out: ParsedRoute[] = [];

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Some routes split the controller array over the next line.
    const nextLine = lines[i + 1] ?? "";
    const window = `${line} ${nextLine}`;

    const pm = PREFIX_RE.exec(line);
    if (pm?.[1]) {
      prefixStack.push(pm[1]);
    }
    if (/\}\s*\)/.test(line) && prefixStack.length > initialPrefix.length) {
      prefixStack.pop();
    }
    const rm = ROUTE_METHOD_RE.exec(line);
    if (rm?.[1] !== undefined) {
      const method = rm[1].toUpperCase();
      const rawUri = rm[2] ?? "";
      const segments = rawUri ? [...prefixStack, rawUri] : [...prefixStack];
      const full = segments.join("/").replace(/\/+/g, "/");

      let controllerClass: string | undefined;
      let actionName: string | undefined;
      const am = ACTION_RE.exec(window);
      if (am?.[1] && am[2]) {
        const alias = am[1];
        actionName = am[2];
        controllerClass =
          imports.get(alias) ??
          // Fallback: asumir App\Http\Controllers\<alias>
          `App\\Http\\Controllers\\${alias}`;
      }

      out.push({
        method,
        uri: full,
        rawUri,
        sourceFile: relPath,
        lineNumber: i + 1,
        prefixChain: [...prefixStack],
        ...(controllerClass ? { controllerClass } : {}),
        ...(actionName ? { actionName } : {}),
      });
    }
  }
  return out;
}

/**
 * Parses all relevant route files.
 *
 * @param filePrefixes file → external prefixes map (from
 *   `ProjectConfig`). If a file isn't here, the `["api"]` prefix is
 *   assumed by default.
 */
export async function parseAllRoutes(
  filePrefixes: Record<string, string[]> = {},
  context: IProjectContext,
): Promise<ParsedRoute[]> {
  // We walk `routes/` directly: any PHP file is a route file. If it
  // is in `filePrefixes`, we use those prefixes; otherwise we assume
  // the `api/` prefix that Laravel adds by default in
  // `RouteServiceProvider::mapApiRoutes()`.
  const fs = await import("node:fs/promises");
  const ROUTES_DIR = projectDirs(context).routes;
  let entries: string[];
  try {
    entries = await fs.readdir(ROUTES_DIR);
  } catch {
    return [];
  }
  const phpFiles = entries.filter((e) => e.endsWith(".php"));
  const out: ParsedRoute[] = [];
  for (const f of phpFiles) {
    const rel = `routes/${f}`;
    const prefixes = filePrefixes[rel] ?? ["api"];
    const parsed = await parseRoutesFile(rel, prefixes, context);
    out.push(...parsed);
  }
  return out;
}


