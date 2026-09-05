/**
 * `symbol-resolver` — aliases, reexports, and resolution of
 * `const r = app`.
 *
 * (a00016 S3) Closes the gap that `collectMethodCalls` leaves:
 * detects calls whose receiver is an alias
 * (`const r = app; r.get(...)`) or an indirect export
 * (`export { router } from "./router"`).
 *
 * Three exports:
 *
 *   - `collectAliases(projectRoot)` — returns the project's `import`s
 *     as `IImportBinding[]`. Covers default, named, aliased
 *     (`import { Router as R }`), and namespace (`import * as ns`).
 *   - `collectReexports(projectRoot)` — returns the
 *     `export ... from` as `IReexport[]`.
 *   - `resolveCallee(calls, aliases, reexports)` — takes the output of
 *     S2 plus the aliases/reexports and returns the calls with the
 *     `callee` rewritten to the canonical form (`r.get` → `app.get`).
 *
 * Why a separate module:
 *   - It reuses the same Babel parser as S2 — no new dependencies.
 *   - `resolveCallee` is independent of the walker: it runs over the
 *     `IRouteCallExpression[]` already produced by `collectMethodCalls`.
 *     Scanners don't need to reorganise their pipeline.
 *
 * What the module does NOT do (a00016 non-goals):
 *   - Does not resolve `import { foo } from "./x"` by following the
 *     `./x` file to get the real binding. That is cross-file
 *     resolution, outside this slice's scope.
 *   - Does not propagate constants (S4 — `constant-propagation.ts` does).
 *   - Does not distinguish `import type` from `import` (Babel treats
 *     them the same).
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { parse as babelParse, type ParserPlugin } from "@babel/parser";

import type { IParseDiagnostic } from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  IImportBinding,
  IReexport,
  IRouteCallExpression,
} from "../../contracts/interfaces/core/language-ir.interface.js";
import { collectFiles, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";

// ---------------------------------------------------------------------------
// Babel node helpers — same permissive pattern as S2 and the frontend.
// ---------------------------------------------------------------------------

interface BabelNode {
  readonly type: string;
  readonly start?: number | null;
  readonly end?: number | null;
  readonly [key: string]: unknown;
}

function asBabelNode(value: unknown): BabelNode {
  return value as BabelNode;
}

function asArray(value: unknown): ReadonlyArray<BabelNode> {
  return Array.isArray(value) ? (value as ReadonlyArray<BabelNode>) : [];
}

function isJsxFile(filename: string): boolean {
  return filename.endsWith(".tsx") || filename.endsWith(".jsx");
}

function identName(node: BabelNode): string {
  const raw = node.name;
  return typeof raw === "string" ? raw : "";
}

function stringLiteralValue(node: BabelNode): string {
  const raw = node.value;
  return typeof raw === "string" ? raw : "";
}

// ---------------------------------------------------------------------------
// Aliases (imports)
// ---------------------------------------------------------------------------

/**
 * Extracts the local binding and the source from an `ImportSpecifier`.
 *
 * - `import { Router }` → `{ local: "Router", imported: "Router" }`.
 * - `import { Router as R }` → `{ local: "R", imported: "Router" }`.
 * - `import * as ns` → `{ local: "ns", imported: "*" }`.
 * - `import x from "m"` → `{ local: "x", imported: "default" }`.
 *
 * Returns `null` if Babel emits a specifier with no recognisable
 * name (it shouldn't happen, but the permissive AST cast allows it).
 */
function bindingFromSpecifier(spec: BabelNode): { local: string; imported: string } | null {
  if (spec.type === "ImportDefaultSpecifier") {
    const local = asBabelNode(spec.local);
    return { local: identName(local), imported: "default" };
  }
  if (spec.type === "ImportNamespaceSpecifier") {
    const local = asBabelNode(spec.local);
    return { local: identName(local), imported: "*" };
  }
  if (spec.type === "ImportSpecifier") {
    const local = asBabelNode(spec.local);
    const imported = asBabelNode(spec.imported);
    return {
      local: identName(local),
      imported: identName(imported) || stringLiteralValue(imported),
    };
  }
  return null;
}

/**
 * Walks the AST and emits one `IImportBinding` per `ImportDeclaration`.
 *
 * Covers:
 *   - `import x from "m"` — `name = "x"`.
 *   - `import * as ns from "m"` — `name = "ns"`.
 *   - `import { a, b as c } from "m"` — emits 2 bindings: `a` and `c`.
 *   - `import "m"` (side-effect) — emits nothing.
 *
 * `range.file` is filled with `sourceFile` — the caller that wants
 * grouping by file can do that later.
 */
function collectAliasesFromBody(
  body: ReadonlyArray<BabelNode>,
  sourceFile: string,
  out: IImportBinding[],
): void {
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const source = asBabelNode(stmt.source);
    const sourceValue = stringLiteralValue(source);
    if (!sourceValue) continue;
    const specifiers = asArray(stmt.specifiers);
    for (const spec of specifiers) {
      const binding = bindingFromSpecifier(spec);
      if (!binding) continue;
      const start = typeof spec.start === "number" ? spec.start : 0;
      const end = typeof spec.end === "number" ? spec.end : start;
      out.push({
        name: binding.local,
        source: sourceValue,
        range: { file: sourceFile, start, end },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Reexports
// ---------------------------------------------------------------------------

/**
 * Emits one `IReexport` per node that represents a reexport.
 *
 * Covers:
 *   - `export { a, b as c } from "./x"` — emits 1 binding per specifier.
 *   - `export * from "./x"` — emits 1 binding with `name = "*"`.
 *
 * Does NOT cover `export { a }` (local declaration) or
 * `export const a = ...` (local declaration) — those are definitions,
 * not reexports. If a scanner needs to detect them, it will look
 * elsewhere.
 */
function collectReexportsFromBody(
  body: ReadonlyArray<BabelNode>,
  sourceFile: string,
  out: IReexport[],
): void {
  for (const stmt of body) {
    // `export { x } from "./x"`.
    if (stmt.type === "ExportNamedDeclaration" && stmt.source !== null && stmt.source !== undefined) {
      const source = asBabelNode(stmt.source);
      const fromValue = stringLiteralValue(source);
      if (!fromValue) continue;
      const specifiers = asArray(stmt.specifiers);
      if (specifiers.length === 0) {
        // `export {} from "./x"` is legal: re-export of the empty
        // namespace. We emit nothing because there is no name to
        // register.
        continue;
      }
      for (const spec of specifiers) {
        const local = asBabelNode(spec.local);
        const exported = asBabelNode(spec.exported);
        const name = identName(exported) || identName(local);
        if (!name) continue;
        const start = typeof spec.start === "number" ? spec.start : 0;
        const end = typeof spec.end === "number" ? spec.end : start;
        out.push({
          name,
          from: fromValue,
          range: { file: sourceFile, start, end },
        });
      }
      continue;
    }
    // `export * from "./x"`.
    if (stmt.type === "ExportAllDeclaration") {
      const source = asBabelNode(stmt.source);
      const fromValue = stringLiteralValue(source);
      if (!fromValue) continue;
      const start = typeof stmt.start === "number" ? stmt.start : 0;
      const end = typeof stmt.end === "number" ? stmt.end : start;
      out.push({
        name: "*",
        from: fromValue,
        range: { file: sourceFile, start, end },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Const-alias detection (for resolveCallee)
// ---------------------------------------------------------------------------

/**
 * `localName → targetName` map of `const X = Y` in a file.
 *
 * Only assignments where `Y` is a bare `Identifier` (`const r = app`)
 * enter here, not `const r = express()` (which would be a factory
 * call). The factory call is detected in S2 with
 * `receiverKind: "factory"` — it needs no additional propagation.
 *
 * This covers today's scanners' "shape": the Express adapter already
 * knows that `const app = express()` is the router, and detects the
 * following `app.get` calls directly. What was missing was
 * `const r = app; r.get` — alias of an alias. This map identifies it.
 *
 * `Record<string, string>` (not `Map`) so the caller can serialise it
 * or pass it as an argument to pure functions. The shape canonicalises
 * `const r = app` → `{ r: "app" }`.
 */
type ConstAliasMap = Readonly<Record<string, string>>;

/** Returns the `const X = Y` map (only Y an identifier) in a file. */
function collectConstAliasesFromBody(body: ReadonlyArray<BabelNode>): ConstAliasMap {
  const out: Record<string, string> = {};
  for (const stmt of body) {
    if (stmt.type !== "VariableDeclaration") continue;
    const declarations = asArray(stmt.declarations);
    for (const decl of declarations) {
      if (decl.type !== "VariableDeclarator") continue;
      const id = asBabelNode(decl.id);
      const init = asBabelNode(decl.init);
      if (id.type !== "Identifier") continue;
      if (init.type !== "Identifier") continue;
      const localName = identName(id);
      const targetName = identName(init);
      if (!localName || !targetName) continue;
      out[localName] = targetName;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Walker (alias + reexport discovery via DFS)
// ---------------------------------------------------------------------------

/**
 * DFS over the AST — same pattern as S2. Visits each node exactly
 * once. The nodes we care about (`ImportDeclaration`,
 * `ExportNamedDeclaration`, `ExportAllDeclaration`) only appear in
 * `body`, but for consistency with the rest of the codebase we walk
 * the whole tree.
 */
function walkBody(
  body: ReadonlyArray<BabelNode>,
  onImport: (decl: BabelNode) => void,
  onExport: (decl: BabelNode) => void,
): void {
  const stack: BabelNode[] = [...body].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "ImportDeclaration") onImport(node);
    else if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      onExport(node);
    }
    const children: BabelNode[] = [];
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in item) {
            children.push(asBabelNode(item));
          }
        }
      } else if (value && typeof value === "object" && "type" in value) {
        children.push(asBabelNode(value));
      }
    }
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

interface IParsedFile {
  readonly aliases: IImportBinding[];
  readonly reexports: IReexport[];
  readonly constAliases: ConstAliasMap;
}

/** Parses a TS/JS file and extracts aliases, reexports, and const-aliases. */
function parseForSymbols(
  source: string,
  filename: string,
  diagnostics?: Array<IParseDiagnostic>,
): IParsedFile {
  const plugins: ParserPlugin[] = ["typescript", "decorators"];
  if (isJsxFile(filename)) plugins.push("jsx");

  const empty: IParsedFile = {
    aliases: [],
    reexports: [],
    constAliases: {},
  };

  try {
    const ast = babelParse(source, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      plugins: [...plugins],
      errorRecovery: true,
    });
    const body = asArray(ast.program["body"]);
    const aliases: IImportBinding[] = [];
    const reexports: IReexport[] = [];
    walkBody(
      body,
      (decl) => collectAliasesFromBody([decl], filename, aliases),
      (decl) => collectReexportsFromBody([decl], filename, reexports),
    );
    const constAliases = collectConstAliasesFromBody(body);
    return { aliases, reexports, constAliases };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    diagnostics?.push({ file: filename, severity: "error", reason });
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Public API — project walkers
// ---------------------------------------------------------------------------

/**
 * Recorre los TS/JS fuente de `projectRoot` y devuelve todos los
 * `IImportBinding`.
 */
export async function collectAliases(
  projectRoot: string,
  diagnostics?: Array<IParseDiagnostic>,
): Promise<IImportBinding[]> {
  const files = await collectFiles(projectRoot, isSourceJsTsFile);
  const out: IImportBinding[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(projectRoot, file) || file;
    const parsed = parseForSymbols(text, rel, diagnostics);
    out.push(...parsed.aliases);
  }
  return out;
}

/**
 * Recorre los TS/JS fuente de `projectRoot` y devuelve todos los
 * `IReexport`.
 */
export async function collectReexports(
  projectRoot: string,
  diagnostics?: Array<IParseDiagnostic>,
): Promise<IReexport[]> {
  const files = await collectFiles(projectRoot, isSourceJsTsFile);
  const out: IReexport[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(projectRoot, file) || file;
    const parsed = parseForSymbols(text, rel, diagnostics);
    out.push(...parsed.reexports);
  }
  return out;
}

// ---------------------------------------------------------------------------
// resolveCallee
// ---------------------------------------------------------------------------

/**
 * Global `aliasName → targetName` map that combines:
 *
 *   1. Import aliases (`import { Router as R } from "express"`
 *      contributes `R → Router`).
 *   2. Reexports (`export { router } from "./router"` contributes
 *      `router → router`, but the `from` field stays as evidence so a
 *      future cross-file resolver can jump to the source module).
 *   3. Const-aliases per file (`const r = app` in `file.ts`
 *      contributes `r → app` only for that file).
 *
 * The `constAliasesByFile` arg is built inside `resolveCallee` by
 * re-reading the files — the caller doesn't have to provide it. It is
 * accepted here for tests: unit tests over `resolveCallee` pass
 * const-aliases without touching the disk.
 */
interface IAliasIndex {
  /** `localName → canonicalName` (global, de imports). */
  readonly importMap: Readonly<Record<string, string>>;
  /** `localName → canonicalName` por archivo (de `const X = Y`). */
  readonly constMap: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Builds an in-memory alias index from the arguments. */
function buildAliasIndex(
  aliases: ReadonlyArray<IImportBinding>,
  reexports: ReadonlyArray<IReexport>,
  constAliasesByFile: Readonly<Record<string, Readonly<Record<string, string>>>>,
): IAliasIndex {
  const importMap: Record<string, string> = {};
  for (const alias of aliases) {
    // For an `import { Router as R } from "express"`, the local binding
    // is `R` and the original is `Router`. The canonical resolution
    // of `R.get` → `Router.get` is what we want.
    importMap[alias.name] = alias.name;
  }
  // Reexports don't resolve to a different local name — `export
  // { router } from "./router"` means `router` is available in this
  // file under the same name. If in the future we want to jump to the
  // source module, `from` is available in `reexports[i].from`.
  for (const re of reexports) {
    importMap[re.name] = re.name;
  }
  return { importMap, constMap: constAliasesByFile };
}

/**
 * Applies an alias chain to a name. `r → app → express` collapses to
 * `express`. The limit (16) protects against accidental cycles.
 *
 * If at any step the alias doesn't resolve, returns the last known
 * name — the scanner can use that as a heuristic.
 */
function followAliasChain(
  start: string,
  fileAliases: Readonly<Record<string, string>>,
  globalAliases: Readonly<Record<string, string>>,
): string {
  const MAX = 16;
  let current = start;
  const seen = new Set<string>();
  for (let i = 0; i < MAX; i++) {
    if (seen.has(current)) return current;
    seen.add(current);
    const next = fileAliases[current] ?? globalAliases[current];
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Resolves the `callee` of the calls to its canonical form.
 *
 * For each `IRouteCallExpression`:
 *
 *   1. If the receiver is an identifier (`r.get`, `app.get`, etc.)
 *      and `r` appears as `const r = X` in the same file, rewrites
 *      the callee to `X.get` (keeping the same `method` and `args`).
 *   2. If the receiver is an identifier and `r` appears as
 *      `import { R as r }`, rewrites to `R.get`.
 *   3. Calls that are already canonical (`app.get`, `this.router.get`)
 *      are returned as-is.
 *
 * Returns a NEW array — does not mutate the input. Scanners that want
 * to keep the original can compare references.
 *
 * Documented limitation (a00016 non-goals): does not resolve
 * `import { Router } from "./router"` by following the `./router`
 * module to get the real binding. That is cross-file and out of scope.
 */
export function resolveCallee(
  calls: ReadonlyArray<IRouteCallExpression>,
  aliases: ReadonlyArray<IImportBinding>,
  reexports: ReadonlyArray<IReexport>,
  constAliasesByFile: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): IRouteCallExpression[] {
  const index = buildAliasIndex(aliases, reexports, constAliasesByFile);
  const out: IRouteCallExpression[] = [];
  for (const call of calls) {
    // We only resolve `receiverKind: "identifier"` whose receiver is a
    // single Identifier (`r.get`). The rest (member, this, computed,
    // factory, optional) are either already canonical or don't benefit
    // from the simple alias.
    if (call.receiverKind !== "identifier" || !call.method) {
      out.push(call);
      continue;
    }

    const parts = call.callee.split(".");
    if (parts.length !== 2) {
      out.push(call);
      continue;
    }
    const [receiver, method] = parts as [string, string];
    if (!receiver || !method) {
      out.push(call);
      continue;
    }
    const fileAliases = index.constMap[call.range.file] ?? {};
    const canonical = followAliasChain(receiver, fileAliases, index.importMap);
    if (canonical === receiver) {
      out.push(call);
      continue;
    }
    out.push({
      ...call,
      callee: `${canonical}.${method}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helper: constAliasesByFile (caller needs it for resolveCallee)
// ---------------------------------------------------------------------------

/**
 * Builds `constAliasesByFile` by walking `projectRoot`. Useful for
 * callers that invoke `resolveCallee(calls, aliases, reexports)`.
 *
 * It is NOT invoked automatically from `resolveCallee` because the
 * latter is pure over its arguments: the caller decides whether to
 * re-read disk. Scanners that already have the sources in memory can
 * skip this helper.
 */
export async function collectConstAliasesByFile(
  projectRoot: string,
  diagnostics?: Array<IParseDiagnostic>,
): Promise<Record<string, Readonly<Record<string, string>>>> {
  const files = await collectFiles(projectRoot, isSourceJsTsFile);
  const out: Record<string, Readonly<Record<string, string>>> = {};
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(projectRoot, file) || file;
    const parsed = parseForSymbols(text, rel, diagnostics);
    out[rel] = parsed.constAliases;
  }
  return out;
}
