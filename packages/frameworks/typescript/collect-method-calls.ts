/**
 * `collectMethodCalls` — un *CallExpression* del AST TS visto desde el
 * adaptador multi-estilo de frameworks.
 *
 * (a00016 S2) Reemplaza la extracción simple de `Identifier.method`
 * que hacía el frontend TS (`packages/core/language-frontends/typescript/
 * typescript.parser.ts` → `collectMethodCalls`). La diferencia es la
 * cantidad de formas del *callee* que reconoce:
 *
 *   - `app.get(...)`             → receiverKind="identifier".
 *   - `this.router.get(...)`     → receiverKind="this".
 *   - `api.router.get(...)`      → receiverKind="member".
 *   - `getRouter().get(...)`     → receiverKind="factory".
 *   - `server["get"](...)`       → receiverKind="computed".
 *   - `router?.get(...)`         → receiverKind="optional".
 *
 * El frontend TS sólo reconoce `Identifier.method` (la primera), así
 * que los 5 estilos restantes eran invisibles para los 6 scanners
 * TS-flavored. Éste es el módulo que los hace visibles, exponiendo
 * un `IRouteCallExpression[]` que los scanners consumen.
 *
 * Por qué NO se mete en el `TSFile` del frontend:
 *   - Mismo argumento que `tagged-template.ts` (a00015 S1): el frontend
 *     es agnóstico del framework. Un collector multi-estilo que sabe
 *     qué cuenta como "callee de ruta" es lógica del adaptador de
 *     frameworks, no del frontend de lenguaje.
 *   - El frontend sigue produciendo su `methodCalls: TSMethodCall[]`
 *     intacto: los scanners que NO migraron (ninguno todavía) siguen
 *     funcionando exactamente igual que antes.
 *
 * Reutiliza `@babel/parser` y `@babel/traverse` ya en el lockfile
 * (`@babel/parser@7.29.8` por el frontend TS; `@babel/traverse` por la
 * misma dependencia transitiva). El pattern es el mismo que
 * `tagged-template.ts`: cast permisivo al `BabelNode`, walker DFS en
 * pila, `errorRecovery: true` para que un fichero raro no aborte el
 * scan.
 *
 * Lo que el módulo NO hace (a00016 non-goals):
 *   - No resuelve tipos.
 *   - No sigue imports (lo hace S3 — `symbol-resolver.ts`).
 *   - No propaga constantes (lo hace S4 — `constant-propagation.ts`).
 *   - No reemplaza al `collectMethodCalls` del frontend; convive con él.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { parse as babelParse, type ParserPlugin } from "@babel/parser";

import type { IParseDiagnostic } from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  IRouteCallExpression,
  ReceiverKind,
} from "../../contracts/interfaces/core/language-ir.interface.js";
import type { TSLiteral } from "../../contracts/interfaces/core/language/typescript-frontend-literal.interface.js";
import { collectFiles, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";

// ---------------------------------------------------------------------------
// Babel node helpers — mismo patrón que `tagged-template.ts` y que el
// frontend TS. La idea es la misma: no importar `@babel/types`, tratar
// el AST como `{ type: string, [k: string]: unknown }` y leer lo que
// necesitamos con `asBabelNode`.
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

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

/** Texto del `Identifier.name` (vacío si no aplica). */
function identName(node: BabelNode): string {
  const raw = node.name;
  return typeof raw === "string" ? raw : "";
}

/** Texto del `StringLiteral.value` (vacío si no aplica). */
function stringLiteralValue(node: BabelNode): string {
  const raw = node.value;
  return typeof raw === "string" ? raw : "";
}

// ---------------------------------------------------------------------------
// Callee decomposition
// ---------------------------------------------------------------------------

/**
 * Forma canónica del callee, una vez descompuesto.
 *
 * `prefix` es la cadena que va ANTES del método (`"app"`, `"this.router"`,
 * `"getRouter()"`, etc.). El scanner que quiera reproducir el código
 * original usa `prefix + "." + method` — salvo cuando `method` está
 * vacío (caso `computed` con string literal), donde la forma es
 * `prefix + '["' + resolvedMethod + '"]'`.
 *
 * `memberIsComputed` indica que la propiedad era un string literal
 * computado (`server["get"]`). El scanner que necesite propagar la
 * constante lo mira; los demás pueden ignorarlo porque `method`
 * siempre queda vacío en ese caso (lo resuelve S4).
 */
interface ICalleeShape {
  readonly prefix: string;
  readonly method: string;
  readonly memberIsComputed: boolean;
  readonly receiverKind: ReceiverKind;
}

/**
 * Descompone el `callee` de una `CallExpression` en las 6 formas que
 * soporta `IRouteCallExpression.receiverKind`.
 *
 * Estructura del callee en cada caso:
 *
 *   - `app.get(...)`              → `MemberExpression { object: Identifier("app"), property: Identifier("get") }`.
 *   - `this.router.get(...)`      → `MemberExpression { object: MemberExpression { object: ThisExpression, property: Identifier("router") }, property: Identifier("get") }`.
 *   - `api.router.get(...)`       → `MemberExpression { object: MemberExpression { object: Identifier("api"), property: Identifier("router") }, property: Identifier("get") }`.
 *   - `getRouter().get(...)`      → `MemberExpression { object: CallExpression { callee: Identifier("getRouter") }, property: Identifier("get") }`.
 *   - `server["get"](...)`        → `MemberExpression { object: Identifier("server"), property: StringLiteral("get"), computed: true }`.
 *   - `router?.get(...)`          → `OptionalMemberExpression { object: Identifier("router"), property: Identifier("get") }`.
 *
 * Devuelve `null` cuando el callee no encaja en ninguna de las 6
 * formas (p. ej. `CallExpression` desnudo, `NewExpression`,
 * `OptionalCallExpression`). Los adapters que sólo les interesen los
 * routes pueden ignorar el `null` y seguir.
 */
function decomposeCallee(callee: BabelNode): ICalleeShape | null {
  // Caso 1: `MemberExpression` clásica.
  if (callee.type === "MemberExpression") {
    const computed = callee.computed === true;
    const property = asBabelNode(callee.property);
    const object = asBabelNode(callee.object);

    if (computed && property.type === "StringLiteral") {
      // `server["get"](...)` — receiverKind="computed" porque la
      // propiedad es un string literal computado, no un identifier.
      return {
        prefix: renderReceiver(object),
        method: stringLiteralValue(property),
        memberIsComputed: true,
        receiverKind: "computed",
      };
    }

    if (!computed && property.type === "Identifier") {
      const method = identName(property);
      if (!method) return null;
      return {
        prefix: renderReceiver(object),
        method,
        memberIsComputed: false,
        // Contamos la profundidad del CALLEE entero: `app.get` es 1
        // nivel (identifier), `api.router.get` son 2 (member),
        // `this.router.get` son 2 con raíz `this` (this).
        receiverKind: calleeReceiverKind(callee),
      };
    }

    // Formas que no encajan: spread, asignación como propiedad, etc.
    return null;
  }

  // Caso 2: `OptionalMemberExpression` — `router?.get(...)`.
  // Babel lo emite como un nodo separado, no como `MemberExpression`
  // con `optional: true`. Hay que distinguirlo para que
  // `receiverKind` quede "optional" en vez de "identifier".
  if (callee.type === "OptionalMemberExpression") {
    const computed = callee.computed === true;
    const property = asBabelNode(callee.property);
    const object = asBabelNode(callee.object);

    if (computed && property.type === "StringLiteral") {
      return {
        prefix: renderReceiver(object),
        method: stringLiteralValue(property),
        memberIsComputed: true,
        // Opcional gana sobre computed porque el `?.` es lo más
        // distintivo del callee.
        receiverKind: "optional",
      };
    }

    if (!computed && property.type === "Identifier") {
      const method = identName(property);
      if (!method) return null;
      return {
        prefix: renderReceiver(object),
        method,
        memberIsComputed: false,
        receiverKind: "optional",
      };
    }
    return null;
  }

  // Cualquier otra forma (`CallExpression`, `Identifier` desnudo,
  // `NewExpression`, ...) no entra en IR — devolvemos null y el
  // collector la ignora.
  return null;
}

/**
 * Cadena legible del receptor. La usan los scanners para reproducir
 * el código original (`callee = prefix + "." + method`).
 *
 * - `Identifier("app")`         → `"app"`.
 * - `ThisExpression`            → `"this"`.
 * - `MemberExpression` anidado  → `"api.router"` (recursivo).
 * - `CallExpression`            → `"getRouter()"` (la llamada entera).
 * - Otro                       → `""` (desconocido, los scanners
 *   pueden usar `receiverKind` para sacar más info si la necesitan).
 */
function renderReceiver(node: BabelNode): string {
  if (node.type === "Identifier") return identName(node);
  if (node.type === "ThisExpression") return "this";
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
    const object = asBabelNode(node.object);
    const property = asBabelNode(node.property);
    const sep = node.type === "OptionalMemberExpression" ? "?." : ".";
    const computed = node.computed === true;
    if (computed && property.type === "StringLiteral") {
      return `${renderReceiver(object)}${sep}["${stringLiteralValue(property)}"]`;
    }
    if (!computed && property.type === "Identifier") {
      return `${renderReceiver(object)}${sep}${identName(property)}`;
    }
    return "";
  }
  if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
    const innerCallee = asBabelNode(node.callee);
    return `${renderReceiver(innerCallee)}()`;
  }
  return "";
}

/**
 * Clasifica el **objeto inmediato** del callee en uno de los
 * `ReceiverKind` para reportar al caller.
 *
 * Esta función NO se usa directamente — `rootReceiverKind` (abajo) la
 * prefiere, porque lo que distingue `this.router.get` de `api.router.get`
 * es el FONDO de la cadena, no el nodo inmediato. Lo dejamos por si
 * algún adapter quiere clasificar el `object` localmente.
 *
 * - `Identifier` → "identifier".
 * - `ThisExpression` → "this".
 * - `MemberExpression` (no computed) → "member".
 * - `MemberExpression` con `computed: true` → "computed" si la
 *   propiedad es un string literal.
 * - `OptionalMemberExpression` → "optional".
 * - `CallExpression` / `OptionalCallExpression` → "factory".
 * - Otro → "member" (fallback conservador).
 */
function receiverKindOf(node: BabelNode): ReceiverKind {
  if (node.type === "Identifier") return "identifier";
  if (node.type === "ThisExpression") return "this";
  if (node.type === "OptionalMemberExpression") return "optional";
  if (node.type === "CallExpression" || node.type === "OptionalCallExpression") return "factory";
  if (node.type === "MemberExpression") {
    if (node.computed === true) {
      const property = asBabelNode(node.property);
      if (property.type === "StringLiteral") return "computed";
    }
    return "member";
  }
  return "member";
}

/**
 * Clasifica el CALLEE (no sólo el `object` inmediato) en uno de los
 * `ReceiverKind` para `MemberExpression`/`OptionalMemberExpression`.
 *
 * Cuenta la profundidad de la cadena y mira el fondo:
 *
 *   - `app.get`              → 1 nivel MemberExpression, fondo
 *                              Identifier → "identifier".
 *   - `api.router.get`       → 2 niveles MemberExpression, fondo
 *                              Identifier → "member".
 *   - `this.router.get`      → 2 niveles, fondo ThisExpression →
 *                              "this".
 *   - `getRouter().get`      → 1 nivel MemberExpression cuyo object
 *                              es una CallExpression → "factory".
 *   - `server["get"]`        → 1 nivel MemberExpression con computed
 *                              string literal → "computed".
 *
 * Por qué contar el CALLEE y no sólo el `object`: para `api.router.get`,
 * el `object` inmediato es `api.router` (otro MemberExpression). Si
 * clasificamos el `object` con `receiverKindOf` sale "member", pero el
 * resultado correcto depende de TODO el callee. Caminar desde el
 * callee y contar MemberExpressions anidados da la respuesta correcta.
 */
function calleeReceiverKind(callee: BabelNode): ReceiverKind {
  // Casos "fuertes" que se detectan sin contar: el fondo ya es un
  // CallExpression, computed string literal o ThisExpression.
  if (callee.type === "OptionalMemberExpression") return "optional";
  if (callee.type !== "MemberExpression") return receiverKindOf(callee);

  // Si la propiedad es un string literal computado, el callee ES
  // `server["get"]` y la propiedad manda.
  const computed = callee.computed === true;
  const property = asBabelNode(callee.property);
  if (computed && property.type === "StringLiteral") return "computed";

  // Caminamos la cadena contando niveles y mirando el fondo.
  let depth = 0;
  let cursor: BabelNode = callee;
  while (cursor.type === "MemberExpression") {
    const isComputed = cursor.computed === true;
    const prop = asBabelNode(cursor.property);
    if (isComputed || prop.type !== "Identifier") break;
    depth += 1;
    cursor = asBabelNode(cursor.object);
  }

  // Fondo especial: `this` o un call.
  if (cursor.type === "ThisExpression") return "this";
  if (cursor.type === "CallExpression" || cursor.type === "OptionalCallExpression") return "factory";

  // Fondo Identifier: 1 nivel → identifier, 2+ → member.
  if (depth === 1) return "identifier";
  if (depth >= 2) return "member";

  // No pudimos caminar — caer al clasificador local del fondo.
  return receiverKindOf(cursor);
}

// ---------------------------------------------------------------------------
// Argument extraction
// ---------------------------------------------------------------------------

/**
 * Convierte un argumento del AST en un `TSLiteral` reducido.
 *
 * NO reusa `literalFromNode` del frontend TS — ese vive en
 * `core/language-frontends/typescript/`, y `frameworks/` no debe
 * importar de `core/` por el invariante a00010. Esta versión cubre
 * lo mínimo que necesitan los scanners TS (string/number/boolean,
 * identifier, null/undefined, arrow) y devuelve `kind: "unknown"`
 * para el resto (object literal, array, spread, llamada).
 *
 * Si un scanner necesita algo más rico, este es el sitio donde
 * extender — pero `unknown` es honesto: si la forma no encaja, el
 * adapter la descarta y el caller sabe que tiene que mirar otra
 * ruta para sacar la información.
 */
function literalFromArg(node: BabelNode): TSLiteral {
  if (node.type === "StringLiteral") {
    const value = stringLiteralValue(node);
    return { kind: "string", value };
  }
  if (node.type === "NumericLiteral") {
    const raw = node.value;
    const value = typeof raw === "number" ? raw : Number(raw);
    return { kind: "number", value: Number.isFinite(value) ? value : 0 };
  }
  if (node.type === "BooleanLiteral") {
    const raw = node.value;
    return { kind: "boolean", value: raw === true };
  }
  if (node.type === "NullLiteral") return { kind: "null" };
  if (node.type === "Identifier" && node.name === "undefined") {
    return { kind: "undefined" };
  }
  if (node.type === "Identifier") {
    const name = identName(node);
    return { kind: "identifier", identifierName: name };
  }
  // Arrow functions: capturamos el bodyRange como hace el frontend.
  if (node.type === "ArrowFunctionExpression") {
    const body = asBabelNode(node.body);
    const start = typeof body.start === "number" ? body.start : 0;
    const end = typeof body.end === "number" ? body.end : start;
    return { kind: "arrow", bodyRange: { start, end } };
  }
  // El resto (ObjectExpression, ArrayExpression, SpreadElement,
  // CallExpression anidada, ...) queda como "unknown" — los scanners
  // que necesiten esto tendrán su propio adapter.
  return { kind: "unknown" };
}

/** Extrae los argumentos de un nodo `CallExpression`. */
function extractArgs(node: BabelNode): ReadonlyArray<TSLiteral> {
  const argsRaw = asArray(node.arguments);
  const out: TSLiteral[] = [];
  for (const arg of argsRaw) out.push(literalFromArg(arg));
  return out;
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

/**
 * DFS por el AST que visita cada nodo exactamente una vez.
 *
 * Mismo patrón que `walk` en el frontend: visita TODO sin podar, y los
 * collectors deciden qué les interesa. Aquí sólo nos interesan los
 * `CallExpression` cuyo callee encaje en una de las 6 formas —
 * el resto se descarta.
 */
function walkBody(
  body: ReadonlyArray<BabelNode>,
  sourceFile: string,
  out: IRouteCallExpression[],
): void {
  // Inicializamos el stack en orden inverso para que el primer
  // nodo de `body` se procese primero al hacer `pop()`. El resultado
  // es un recorrido top-down por el archivo: las llamadas se emiten
  // en el orden en que aparecen en el código, que es lo que los
  // scanners esperan para correlacionar rutas con líneas.
  const stack: BabelNode[] = [...body].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const callee = asBabelNode(node.callee);
      const shape = decomposeCallee(callee);
      if (shape) {
        const start = typeof node.start === "number" ? node.start : 0;
        const end = typeof node.end === "number" ? node.end : start;
        const args = extractArgs(node);
        const calleeText = shape.memberIsComputed
          ? `${shape.prefix}["${shape.method}"]`
          : shape.method
            ? `${shape.prefix}.${shape.method}`
            : shape.prefix;
        out.push({
          callee: calleeText,
          receiverKind: shape.receiverKind,
          method: shape.method,
          args,
          range: { file: sourceFile, start, end },
        });
      }
    }

    // Hijos: cualquier campo que sea objeto/array con `type`. El
    // recorrido es DFS en preorden (top-down), igual que el frontend.
    // Metemos los hijos en orden INVERSO al stack para que el primer
    // hijo salga primero al hacer `pop()` — preservando el orden del
    // archivo en el output.
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Parsea un archivo TS/JS y devuelve sus `IRouteCallExpression`.
 *
 * Si Babel no puede parsear el archivo, registra el motivo en
 * `diagnostics` (si vino) y devuelve `[]`. Mismo contrato que
 * `collectTaggedTemplatesFromSource` y `parseModule`: degradar sin
 * ruido en vez de abortar el scan.
 */
export function collectMethodCallsFromSource(
  source: string,
  filename: string,
  diagnostics?: Array<IParseDiagnostic>,
): IRouteCallExpression[] {
  const plugins: ParserPlugin[] = ["typescript", "decorators"];
  if (isJsxFile(filename)) plugins.push("jsx");

  try {
    const ast = babelParse(source, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      plugins: [...plugins],
      errorRecovery: true,
    });
    const body = asArray(ast.program["body"]);
    const out: IRouteCallExpression[] = [];
    walkBody(body, filename, out);
    return out;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    diagnostics?.push({ file: filename, severity: "error", reason });
    return [];
  }
}

/**
 * Recorre los TS/JS fuente de `projectRoot` y devuelve todas las
 * `IRouteCallExpression` que encuentre.
 *
 * Usa `collectFiles(projectRoot, isSourceJsTsFile)` — el mismo helper
 * que `tagged-template.ts`, `express.scanner.ts` y `graphql.scanner.ts`
 * — así que respeta los mismos excludes (`node_modules`, `dist`, etc.).
 *
 * `diagnostics` (opcional) recibe los archivos que el parser no pudo
 * digerir. Si no se pasa, los fallos se tragan silenciosamente.
 */
export async function collectMethodCalls(
  projectRoot: string,
  diagnostics?: Array<IParseDiagnostic>,
): Promise<IRouteCallExpression[]> {
  const files = await collectFiles(projectRoot, isSourceJsTsFile);
  const out: IRouteCallExpression[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(projectRoot, file) || file;
    out.push(...collectMethodCallsFromSource(text, rel, diagnostics));
  }
  return out;
}
