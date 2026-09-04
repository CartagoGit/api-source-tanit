/**
 * `symbol-resolver` — aliases, reexports y resolución de `const r = app`.
 *
 * (a00016 S3) Cierra el gap que `collectMethodCalls` deja: detecta
 * llamadas cuyo receptor es un alias (`const r = app; r.get(...)`) o
 * una exportación indirecta (`export { router } from "./router"`).
 *
 * Tres exports:
 *
 *   - `collectAliases(projectRoot)` — devuelve los `import` del
 *     proyecto como `IImportBinding[]`. Cubre default, named,
 *     aliased (`import { Router as R }`) y namespace
 *     (`import * as ns`).
 *   - `collectReexports(projectRoot)` — devuelve los
 *     `export ... from` como `IReexport[]`.
 *   - `resolveCallee(calls, aliases, reexports)` — toma el output de
 *     S2 + los aliases/reexports y devuelve las llamadas con el
 *     `callee` reescrito a la forma canónica (`r.get` → `app.get`).
 *
 * Por qué un módulo aparte:
 *   - Reusa el mismo parser Babel que S2 — no añade dependencias.
 *   - `resolveCallee` es independiente del walker: corre sobre los
 *     `IRouteCallExpression[]` que ya produjo `collectMethodCalls`.
 *     Los scanners no necesitan reorganizar su pipeline.
 *
 * Lo que el módulo NO hace (a00016 non-goals):
 *   - No resuelve `import { foo } from "./x"` siguiendo al fichero
 *     `./x` para sacar el binding real. Eso es resolución
 *     cross-file, fuera del scope de esta slice.
 *   - No propaga constantes (lo hace S4 — `constant-propagation.ts`).
 *   - No distingue `import type` de `import` (Babel los trata igual).
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
// Babel node helpers — mismo patrón permisivo que S2 y que el frontend.
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
 * Saca el binding local y la fuente de un `ImportSpecifier`.
 *
 * - `import { Router }` → `{ local: "Router", imported: "Router" }`.
 * - `import { Router as R }` → `{ local: "R", imported: "Router" }`.
 * - `import * as ns` → `{ local: "ns", imported: "*" }`.
 * - `import x from "m"` → `{ local: "x", imported: "default" }`.
 *
 * Devuelve `null` si Babel emite un specifier sin nombre reconocible
 * (no debería pasar, pero el cast permisivo del AST lo permite).
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
 * Recorre el AST y emite `IImportBinding` por cada `ImportDeclaration`.
 *
 * Cubre:
 *   - `import x from "m"` — `name = "x"`.
 *   - `import * as ns from "m"` — `name = "ns"`.
 *   - `import { a, b as c } from "m"` — emite 2 bindings: `a` y `c`.
 *   - `import "m"` (side-effect) — no emite nada.
 *
 * El `range.file` se rellena con `sourceFile` — el caller que quiera
 * grouping por archivo puede hacerlo después.
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
 * Emite `IReexport` por cada nodo que represente un reexport.
 *
 * Cubre:
 *   - `export { a, b as c } from "./x"` — emite 1 binding por specifier.
 *   - `export * from "./x"` — emite 1 binding con `name = "*"`.
 *
 * NO cubre `export { a }` (declaración local) ni
 * `export const a = ...` (declaración local) — eso son definiciones,
 * no reexports. Si el scanner necesita detectarlos, mirará otro sitio.
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
        // `export {} from "./x"` es legal: reexport del namespace
        // vacío. No emitimos nada porque no hay un nombre que
        // registrar.
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
// Const-alias detection (para resolveCallee)
// ---------------------------------------------------------------------------

/**
 * Mapa `localName → targetName` de los `const X = Y` en un archivo.
 *
 * Sólo entran las asignaciones donde `Y` es un `Identifier` desnudo
 * (`const r = app`), no `const r = express()` (que sería un factory
 * call). El factory call se detecta en S2 con `receiverKind: "factory"`
 * — no necesita propagación adicional.
 *
 * Esto cubre la "shape" de los scanners de hoy: el adaptador de
 * Express ya sabe que `const app = express()` es el router, y los
 * siguientes `app.get` los detecta directamente. Lo que faltaba era
 * `const r = app; r.get` — el alias de un alias. Este map lo
 * identifica.
 *
 * `Record<string, string>` (no `Map`) para que el caller lo pueda
 * serializar o pasar como argumento a funciones puras. La forma
 * canoniza `const r = app` → `{ r: "app" }`.
 */
type ConstAliasMap = Readonly<Record<string, string>>;

/** Devuelve el mapa de `const X = Y` (sólo Y identifier) en un archivo. */
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
 * DFS por el AST — mismo patrón que S2. Visita cada nodo exactamente
 * una vez. Los nodos que nos interesan (`ImportDeclaration`,
 * `ExportNamedDeclaration`, `ExportAllDeclaration`) sólo aparecen
 * en `body`, pero por uniformidad con el resto del codebase
 * caminamos todo el árbol.
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

/** Parsea un archivo TS/JS y extrae aliases, reexports y const-aliases. */
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
 * Mapa global de `aliasName → targetName` que combina:
 *
 *   1. Aliases de import (`import { Router as R } from "express"`
 *      aporta `R → Router`).
 *   2. Reexports (`export { router } from "./router"` aporta
 *      `router → router`, pero el campo `from` queda como evidencia
 *      para que un futuro cross-file resolver pueda saltar al
 *      módulo).
 *   3. Const-aliases por archivo (`const r = app` en `file.ts` aporta
 *      `r → app` sólo para ese archivo).
 *
 * El arg `constAliasesByFile` se construye dentro de `resolveCallee`
 * re-leyendo los archivos — el caller no lo tiene que aportar. Se
 * acepta aquí para tests: los tests unitarios sobre
 * `resolveCallee` pasan const-aliases sin tocar disco.
 */
interface IAliasIndex {
  /** `localName → canonicalName` (global, de imports). */
  readonly importMap: Readonly<Record<string, string>>;
  /** `localName → canonicalName` por archivo (de `const X = Y`). */
  readonly constMap: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Construye un índice en memoria de aliases a partir de los argumentos. */
function buildAliasIndex(
  aliases: ReadonlyArray<IImportBinding>,
  reexports: ReadonlyArray<IReexport>,
  constAliasesByFile: Readonly<Record<string, Readonly<Record<string, string>>>>,
): IAliasIndex {
  const importMap: Record<string, string> = {};
  for (const alias of aliases) {
    // Para un `import { Router as R } from "express"`, el binding
    // local es `R` y el original es `Router`. La resolución canónica
    // de `R.get` → `Router.get` es lo que queremos.
    importMap[alias.name] = alias.name;
  }
  // Los reexports no resuelven a un nombre local diferente — `export
  // { router } from "./router"` significa que `router` está disponible
  // en este archivo con el mismo nombre. Si en el futuro queremos
  // saltar al módulo origen, `from` queda disponible en
  // `reexports[i].from`.
  for (const re of reexports) {
    importMap[re.name] = re.name;
  }
  return { importMap, constMap: constAliasesByFile };
}

/**
 * Aplica una cadena de alias a un nombre. `r → app → express` colapsa
 * a `express`. El límite (16) protege contra ciclos accidentales.
 *
 * Si en algún paso el alias no resuelve, devuelve el último nombre
 * conocido — el scanner puede usar eso como heurística.
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
 * Resuelve los `callee` de las llamadas a su forma canónica.
 *
 * Por cada `IRouteCallExpression`:
 *
 *   1. Si el receiver es un identifier (`r.get`, `app.get`, etc.) y
 *      `r` aparece como `const r = X` en el mismo archivo, reescribe
 *      el callee a `X.get` (con la misma `method` y `args`).
 *   2. Si el receiver es un identifier y `r` aparece como
 *      `import { R as r }`, reescribe a `R.get`.
 *   3. Las llamadas ya canónicas (`app.get`, `this.router.get`) se
 *      devuelven tal cual.
 *
 * Devuelve un NUEVO array — no muta el input. Los scanners que
 * quieran conservar el original pueden comparar referencias.
 *
 * Limitación documentada (a00016 non-goals): no resuelve
 * `import { Router } from "./router"` siguiendo al módulo
 * `./router` para sacar el binding real. Eso es cross-file y
 * queda fuera del scope.
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
    // Sólo resolvemos los `receiverKind: "identifier"` cuyo receiver
    // sea un único Identifier (`r.get`). El resto (member, this,
    // computed, factory, optional) ya son canónicos o no se
    // benefician del alias simple.
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
// Helper: constAliasesByFile (caller lo necesita para resolveCallee)
// ---------------------------------------------------------------------------

/**
 * Construye `constAliasesByFile` recorriendo `projectRoot`. Útil para
 * los callers que invocan `resolveCallee(calls, aliases, reexports)`.
 *
 * NO se invoca automáticamente desde `resolveCallee` porque ésa es
 * pura sobre sus argumentos: el caller decide si quiere re-leer
 * disco. Los scanners que ya tienen los sources en memoria pueden
 * saltarse este helper.
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
