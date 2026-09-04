/**
 * `parse(source, filename): TSFile` — el frontend TypeScript.
 *
 * Consume código fuente JS/TS y devuelve un AST normalizado
 * (`TSFile`) sobre el que los 6 scanners JS/TS (Express, NestJS,
 * Fastify, Hono, Next.js, tRPC) escriben adaptadores semánticos.
 *
 * ## Por qué `@babel/parser`
 *
 * Soporta TypeScript como first-class (`plugins: ['typescript']`),
 * ya vivía en el lockfile como dep transitiva de `magicast`, y la
 * forma del AST es ESTree — el mismo árbol canónico que usan
 * ESLint, Prettier y casi todo el ecosistema JS. Arrastra ~100KB
 * y no requiere type-checking (no necesitamos tipos: solo
 * reconocemos la forma del código).
 *
 * Las alternativas que se consideraron (a00010 S7):
 *
 *   - `typescript` compiler API: 50MB, hace type-checking que no
 *     necesitamos, y el AST tiene tipos genéricos más feos de
 *     consumir.
 *   - `@typescript-eslint/parser`: arrastra
 *     `@typescript-eslint/types` + `typescript-estree`, doble
 *     transformación sobre el AST de TS que aquí no aporta.
 *   - `acorn`: sin soporte TS nativo (habría que añadir
 *     `acorn-typescript` encima, otra dep).
 *
 * ## Lo que el parser VE y lo que DEVUELVE
 *
 * Babel produce ESTree completo; este módulo se queda con cinco
 * categorías — imports, símbolos, clases, method calls, assignments
 * — y descarta el resto. La forma `TSFile` es deliberadamente
 * plana (sin referencias cruzadas entre las cinco colecciones)
 * porque los scanners la recorren linealmente.
 *
 * ## Lo que NO hace
 *
 * No resuelve tipos (`<T>`), no sigue imports (`import type` no se
 * distingue de `import`), no ejecuta el código. Es un parser
 * sintáctico, no semántico.
 *
 * (a00010 S7 — slice AST TypeScript)
 */

import { parse as babelParse, type ParserPlugin } from "@babel/parser";

import type {
  TSAssignment,
  TSClass,
  TSClassMethod,
  TSDecorator,
  TSFile,
  TSImport,
  TSImportBinding,
  TSMethodCall,
  TSSymbol,
} from "../../../contracts/interfaces/core/language/typescript-frontend.interface.js";
import type {
  TSLiteral,
  TSLiteralBodyRange,
} from "../../../contracts/interfaces/core/language/typescript-frontend-literal.interface.js";
import type { IParseDiagnostic } from "../../../contracts/interfaces/core/scanner.interface.js";

// ---------------------------------------------------------------------------
// Babel node helpers
// ---------------------------------------------------------------------------

/**
 * Babel ESTree node — la forma mínima que necesitamos reconocer.
 *
 * Es un tipo permisivo (`{ readonly type: string; [key: string]:
 * unknown }`): solo escribimos los campos que visitamos, y todo lo
 * demás queda como `unknown` para que TS no proteste con `Property
 * 'X' does not exist on type 'BabelNode'` cuando Babel añade un
 * campo que no nos interesa.
 *
 * El motivo de no importar `@babel/types` directamente es pragmático:
 *   - `@babel/types` arrastra ~2500 tipos (`Node`, `NodeChild`...) que
 *     ralentizan el `tsc` y llenan de imports que este módulo no usa.
 *   - El coste de no tenerlos tipados es nulo: este parser **lee** el
 *     árbol, no lo construye. Si una propiedad falta o cambia, el
 *     `undefined`/`null` que sale se traduce a `kind: "unknown"` en
 *     `TSLiteral` y los adapters lo descartan sin ruido.
 */
interface BabelNode {
  readonly type: string;
  readonly start?: number | null;
  readonly end?: number | null;
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number };
  } | null;
  readonly [key: string]: unknown;
}

/** Trata un `unknown` (que viene del AST) como BabelNode. */
function asBabelNode(value: unknown): BabelNode {
  return value as BabelNode;
}

/** Lee una propiedad del nodo AST devolviendo `unknown`. */
function get(node: BabelNode, key: string): unknown {
  return node[key];
}

/** Cast seguro de un array de unknowns a array de BabelNodes. */
function asArray(value: unknown): ReadonlyArray<BabelNode> {
  return Array.isArray(value) ? (value as ReadonlyArray<BabelNode>) : [];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parsea `source` (código TS/JS) y devuelve el AST normalizado.
 *
 * `filename` se adjunta al AST para que los adapters puedan
 * reportar errores y los scanners enseñárselo al usuario. No se usa
 * internamente — Babel lo acepta pero aquí no nos interesa.
 *
 * Si Babel no puede parsear el archivo, lanza `SyntaxError`. Los
 * callers que quieren degradar sin ruido usan `parseModule` con un
 * array de `IParseDiagnostic` (a00011 C-7 / B-rev-13).
 *
 * El orden dentro de cada colección de `TSFile` es top-down respecto
 * al archivo: al final del parse cada colección se ordena por
 * `(line, column)` ascendente, de modo que el contrato no dependa del
 * orden interno del walker (a00011 C-7 / B-rev-11).
 *
 * Audit 2026-09-04 P2 #7: el plugin `jsx` se activa cuando
 * `filename` termina en `.tsx`/`.jsx`. Sin esto, Babel rechazaba la
 * sintaxis JSX (`<Foo />`) con syntax error y el scanner perdía
 * componentes Next.js / React.
 */

/**
 * Indica si el archivo es JSX/TSX.
 */
function isJsxFile(filename: string): boolean {
  return filename.endsWith(".tsx") || filename.endsWith(".jsx");
}

export function parse(source: string, filename: string): TSFile {
  // Babel acepta strings o configuraciones tipadas (ParserPlugin es
  // el alias de `PluginConfig` en las definiciones de tipos del
  // paquete). Mantenemos el array como strings para no arrastrar
  // ~2500 tipos de `@babel/types`.
  const plugins: ParserPlugin[] = ["typescript", "decorators"];
  // JSX solo cuando toca: activarlo en `.ts`/`.js` produce falsos
  // positivos al encontrar `<` en comparaciones (`if (a < b)`).
  if (isJsxFile(filename)) plugins.push("jsx");
  const ast = babelParse(source, {
    sourceType: "module",
    allowImportExportEverywhere: true,
    // Plugins que cubren el código que los scanners miran:
    //   - `typescript`: soporte TS nativo (TSTypeAnnotation,
    //     TSInterfaceDeclaration, generics).
    //   - `decorators`: NestJS usa `@Controller('/users')`,
    //     `@Get(':id')`, etc. sobre métodos y clases.
    //   - `jsx`: solo se activa para `.tsx`/`.jsx`. Sin esto, Babel
    //     rechaza sintaxis JSX como `<Foo />` con syntax error y el
    //     scanner pierde el archivo.
    //   - `classProperties`: las propiedades de clase con valores
    //     usan la propuesta de class fields. Babel 8 ya lo trae
    //     integrado, pero declararlo deja claro el subset soportado.
    plugins: [...plugins],
    // Los scanners ya strippean comentarios antes (ver
    // `stripJsComments`); pero por si llega un archivo con
    // comentarios no stripped, dejamos que Babel los ignore.
    errorRecovery: true,
  });

  const body = asArray(ast.program["body"]);

  return sortTopDown({
    imports: collectImports(body),
    symbols: collectSymbols(body),
    classes: collectClasses(body),
    methodCalls: collectMethodCalls(body),
    assignments: collectAssignments(body),
    decorators: collectDecorators(body),
    filename,
  });
}

// ---------------------------------------------------------------------------
// Top-down ordering (a00011 C-7 / B-rev-11)
// ---------------------------------------------------------------------------

/** Posición (línea, columna) de cualquier nodo ordenable del AST. */
interface IPositioned {
  readonly line: number;
  readonly column?: number;
}

/**
 * Ordena cada colección del `TSFile` por posición ascendente.
 *
 * La comparación es `(line, column)`: mismo criterio con el que un
 * lector humano recorre el archivo. `Array.prototype.sort` es estable
 * (spec ES2019), así que los empates conservan el orden de emisión.
 *
 * Las colecciones sin `column` (`symbols`, `assignments`, `decorators`,
 * `classes`) comparan por `line` sola — el `?? 0` de `column` solo
 * desempata cuando ambas líneas son iguales, que es exactamente el
 * caso en que hace falta.
 */
function sortTopDown(file: TSFile): TSFile {
  const byPosition = (a: IPositioned, b: IPositioned): number =>
    a.line - b.line || (a.column ?? 0) - (b.column ?? 0);
  return {
    imports: [...file.imports], // ya salen en orden de declaración; copia por uniformidad
    symbols: [...file.symbols].sort(byPosition),
    classes: [...file.classes].sort(byPosition),
    methodCalls: [...file.methodCalls].sort(byPosition),
    assignments: [...file.assignments].sort(byPosition),
    decorators: [...file.decorators].sort(byPosition),
    filename: file.filename,
  };
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

/**
 * Extrae el binding local de un specifier de import.
 *
 * `import x from "m"` → `{ local: "x", imported: "default", ... }`.
 * `import * as ns from "m"` → `{ local: "ns", imported: "*", ... }`.
 * `import { A as B } from "m"` → `{ local: "B", imported: "A", ... }`.
 *
 * Devuelve `null` para specifiers sin nombre reconocible (no debería
 * pasar con Babel, pero el cast permisivo del AST lo permite).
 */
function bindingFromSpecifier(spec: BabelNode): TSImportBinding | null {
  if (spec.type === "ImportDefaultSpecifier") {
    const local = asBabelNode(get(spec, "local"));
    const name = String(local.name ?? "");
    return name ? { local: name, imported: "default", isDefault: true } : null;
  }
  if (spec.type === "ImportNamespaceSpecifier") {
    const local = asBabelNode(get(spec, "local"));
    const name = String(local.name ?? "");
    return name
      ? { local: name, imported: "*", isDefault: false, isNamespace: true }
      : null;
  }
  if (spec.type === "ImportSpecifier") {
    const imported = asBabelNode(get(spec, "imported"));
    const local = asBabelNode(get(spec, "local"));
    const importedName = String(imported.name ?? imported.value ?? "");
    const localName = String(local.name ?? importedName);
    return importedName
      ? { local: localName, imported: importedName, isDefault: false }
      : null;
  }
  return null;
}

function collectImports(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSImport> {
  const out: TSImport[] = [];
  for (const node of body) {
    if (node.type !== "ImportDeclaration") continue;
    const sourceNode = asBabelNode(get(node, "source"));
    if (sourceNode.type !== "StringLiteral") continue;
    const source = String(sourceNode.value ?? "");
    const bindings: TSImportBinding[] = [];
    for (const spec of asArray(get(node, "specifiers"))) {
      const binding = bindingFromSpecifier(spec);
      if (binding) bindings.push(binding);
    }
    // `names` se deriva de `bindings` para compat con los scanners
    // que ya lo consumen (a00011 C-7 / B-rev-12).
    const names = bindings.map((b) => b.imported);
    out.push({ source, names, bindings });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Symbols (top-level: function, class, var/let/const)
// ---------------------------------------------------------------------------

function collectSymbols(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSSymbol> {
  const out: TSSymbol[] = [];
  for (const node of body) {
    if (node.type === "FunctionDeclaration") {
      const id = asBabelNode(get(node, "id"));
      const name = String(id.name ?? "");
      if (!name) continue;
      out.push({
        name,
        kind: "function",
        exported: false,
        line: id.loc?.start.line ?? 1,
      });
      continue;
    }
    if (node.type === "ClassDeclaration") {
      const id = asBabelNode(get(node, "id"));
      const name = String(id.name ?? "");
      if (!name) continue;
      out.push({
        name,
        kind: "class",
        exported: false,
        line: id.loc?.start.line ?? 1,
      });
      continue;
    }
    if (node.type === "VariableDeclaration") {
      for (const decl of asArray(get(node, "declarations"))) {
        if (decl.type !== "VariableDeclarator") continue;
        const id = asBabelNode(get(decl, "id"));
        if (id.type !== "Identifier") continue;
        out.push({
          name: String(id.name ?? ""),
          kind: "variable",
          exported: false,
          line: id.loc?.start.line ?? 1,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

function collectClasses(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSClass> {
  const out: TSClass[] = [];
  for (const node of body) {
    let classNode: BabelNode | null = null;
    let exported = false;
    if (node.type === "ClassDeclaration") {
      classNode = node;
    } else if (node.type === "ExportNamedDeclaration") {
      // `export { foo }` deja `declaration: null`; `export class Foo`
      // lo deja con `declaration` siendo la ClassDeclaration. Hay que
      // distinguir los dos casos o peta con `null.type`.
      const inner = get(node, "declaration");
      if (inner && typeof inner === "object" && "type" in inner) {
        const innerNode = asBabelNode(inner);
        if (innerNode.type === "ClassDeclaration") {
          classNode = innerNode;
          exported = true;
        }
      }
    }
    if (!classNode) continue;

    const id = asBabelNode(get(classNode, "id"));
    const name = String(id.name ?? "");
    if (!name) continue;

    const decorators = collectDecoratorsFor(asArray(get(classNode, "decorators")), name);
    const methods = collectClassMethods(classNode);

    out.push({
      name,
      exported,
      decorators,
      methods,
      line: classNode.loc?.start.line ?? 1,
    });
  }
  return out;
}

function collectClassMethods(classNode: BabelNode): ReadonlyArray<TSClassMethod> {
  const out: TSClassMethod[] = [];
  const body = asBabelNode(get(classNode, "body"));
  const classBody = asArray(get(body, "body"));
  for (const member of classBody) {
    if (member.type !== "ClassMethod" && member.type !== "MethodDefinition") continue;
    const key = asBabelNode(get(member, "key"));
    const name = String(key.name ?? "");
    if (!name) continue;
    const decorators = collectDecoratorsFor(asArray(get(member, "decorators")), name);
    const args: TSLiteral[] = [];
    for (const dec of decorators) args.push(...dec.args);
    out.push({
      name,
      decorators,
      args,
      line: member.loc?.start.line ?? 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Method calls: `<ident>.<method>(<args>)`
// ---------------------------------------------------------------------------

/**
 * Las llamadas a método que parecen declaraciones de ruta.
 *
 * Reconoce las cinco formas que viven en los proyectos reales:
 *
 *   - `app.get("/x", h)` → callee `"app.get"`.
 *   - `router.post("/x", h)` → callee `"router.post"`.
 *   - `controller.Get("x")` (NestJS) → callee `"controller.Get"`.
 *   - `server.route({ method, path })` → se queda fuera: el adapter
 *     lo maneja con un caso dedicado (es un object literal, no un
 *     method call directo).
 *
 * `bodyRange` se rellena solo cuando el último argumento es una
 * arrow function — los adapters lo usan para reentrar al cuerpo
 * con sus propias regexes (buscar `Schema.parse(...)`, parsear
 * `req.body`, etc.).
 */
function collectMethodCalls(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSMethodCall> {
  const out: TSMethodCall[] = [];
  walk(body, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = asBabelNode(get(node, "callee"));
    if (callee.type !== "MemberExpression") return;
    const object = asBabelNode(get(callee, "object"));
    if (object.type !== "Identifier") return;
    const property = asBabelNode(get(callee, "property"));
    const ident = String(object.name ?? "");
    const prop = String(property.name ?? property.value ?? "");
    if (!ident || !prop) return;

    const callArgs: TSLiteral[] = [];
    let bodyRange: TSLiteralBodyRange | undefined;
    const args = asArray(get(node, "arguments"));
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      const lit = literalFromNode(arg);
      // Si el último argumento es una arrow function, capturamos el
      // rango del cuerpo. Babel pone el `body` en el nodo arrow
      // directamente (BlockStatement para `{ ... }` o expresión para
      // `=> x`).
      if (i === args.length - 1 && arg.type === "ArrowFunctionExpression") {
        const arrowBody = asBabelNode(get(arg, "body"));
        const start = arrowBody.start;
        const end = arrowBody.end;
        if (typeof start === "number" && typeof end === "number") {
          bodyRange = { start, end };
        }
      }
      callArgs.push(lit);
    }

    out.push({
      callee: `${ident}.${prop}`,
      args: callArgs,
      line: node.loc?.start.line ?? 1,
      column: node.loc?.start.column ?? 0,
      ...(bodyRange !== undefined ? { bodyRange } : {}),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Assignments: `<name> = <expr>`
// ---------------------------------------------------------------------------

function collectAssignments(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSAssignment> {
  const out: TSAssignment[] = [];
  walk(body, (node) => {
    if (node.type === "VariableDeclarator") {
      const id = asBabelNode(get(node, "id"));
      if (id.type !== "Identifier") return;
      const init = get(node, "init");
      if (!init) return;
      out.push({
        name: String(id.name ?? ""),
        value: literalFromNode(asBabelNode(init)),
        line: id.loc?.start.line ?? 1,
      });
      return;
    }
    if (node.type === "AssignmentExpression") {
      const left = asBabelNode(get(node, "left"));
      if (left.type !== "Identifier") return;
      const right = get(node, "right");
      if (!right) return;
      out.push({
        name: String(left.name ?? ""),
        value: literalFromNode(asBabelNode(right)),
        line: left.loc?.start.line ?? 1,
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Decorators
// ---------------------------------------------------------------------------

function collectDecorators(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSDecorator> {
  const out: TSDecorator[] = [];
  walk(body, (node) => {
    if (
      node.type !== "ClassDeclaration" &&
      node.type !== "ClassMethod" &&
      node.type !== "MethodDefinition"
    ) return;
    let target = "";
    if (node.type === "ClassDeclaration") {
      const id = asBabelNode(get(node, "id"));
      target = String(id.name ?? "");
    } else {
      const key = asBabelNode(get(node, "key"));
      target = String(key.name ?? "");
    }
    if (!target) return;
    for (const dec of collectDecoratorsFor(asArray(get(node, "decorators")), target)) out.push(dec);
  });
  return out;
}

function collectDecoratorsFor(
  decorators: ReadonlyArray<BabelNode>,
  target: string,
): ReadonlyArray<TSDecorator> {
  const out: TSDecorator[] = [];
  for (const dec of decorators) {
    const expr = asBabelNode(get(dec, "expression"));
    let name = "";
    const args: TSLiteral[] = [];
    if (expr.type === "Identifier") {
      name = String(expr.name ?? "");
    } else if (expr.type === "CallExpression") {
      const callee = asBabelNode(get(expr, "callee"));
      if (callee.type === "Identifier") {
        name = String(callee.name ?? "");
      } else if (callee.type === "MemberExpression") {
        const property = asBabelNode(get(callee, "property"));
        name = String(property.name ?? "");
      }
      for (const arg of asArray(get(expr, "arguments"))) args.push(literalFromNode(arg));
    }
    if (!name) continue;
    out.push({
      name,
      args,
      target,
      line: dec.loc?.start.line ?? 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Literal extraction
// ---------------------------------------------------------------------------

/**
 * Convierte un nodo Babel en un `TSLiteral` normalizado.
 *
 * Reconoce:
 *   - `StringLiteral`, `NumericLiteral`, `BooleanLiteral`, `NullLiteral`.
 *   - `Identifier` → kind "identifier".
 *   - `ObjectExpression` → kind "object" con `objectShape`.
 *   - `ArrayExpression` → kind "array" con `arrayItems`.
 *   - `ArrowFunctionExpression` → kind "arrow" con `bodyRange`.
 *   - `CallExpression` con un único argumento literal:
 *     desciende al argumento. Es lo que hace que
 *     `const router = Router({ prefix: '/api/v1' })` exponga el
 *     `objectShape` del prefix en lugar de quedar como call
 *     opaco — los adapters de Express lo necesitan para detectar
 *     `Router({ prefix })`.
 *
 * Todo lo demás se representa como `kind: "unknown"`. Los adapters
 * saben que un unknown no es una ruta, un path o un body — es
 * `new Foo(...)`, una llamada con varios argumentos, etc.
 */
function literalFromNode(node: BabelNode): TSLiteral {
  switch (node.type) {
    case "StringLiteral":
      return { kind: "string", value: String(node.value ?? "") };
    case "NumericLiteral":
      return { kind: "number", value: Number(node.value ?? 0) };
    case "BooleanLiteral":
      return { kind: "boolean", value: Boolean(node.value) };
    case "NullLiteral":
      return { kind: "null" };
    case "Identifier":
      return { kind: "identifier", identifierName: String(node.name ?? "") };
    case "ObjectExpression": {
      const shape: { key: string; literal: TSLiteral }[] = [];
      for (const prop of asArray(get(node, "properties"))) {
        if (prop.type !== "ObjectProperty") continue;
        const keyNode = asBabelNode(get(prop, "key"));
        let key = "";
        if (keyNode.type === "Identifier") key = String(keyNode.name ?? "");
        else if (keyNode.type === "StringLiteral") key = String(keyNode.value ?? "");
        if (!key) continue;
        const valueNode = get(prop, "value");
        if (!valueNode) continue;
        shape.push({ key, literal: literalFromNode(asBabelNode(valueNode)) });
      }
      return { kind: "object", objectShape: shape };
    }
    case "ArrayExpression": {
      const items: TSLiteral[] = [];
      for (const el of asArray(get(node, "elements"))) if (el) items.push(literalFromNode(el));
      return { kind: "array", arrayItems: items };
    }
    case "ArrowFunctionExpression": {
      const body = asBabelNode(get(node, "body"));
      const start = body.start;
      const end = body.end;
      if (typeof start === "number" && typeof end === "number") {
        const range: TSLiteralBodyRange = { start, end };
        return { kind: "arrow", bodyRange: range };
      }
      return { kind: "arrow" };
    }
    case "CallExpression": {
      // Wrapper transparente: `Router({ prefix })`,
      // `express()`, `middleware([...])`. Si la llamada tiene un
      // único argumento que es un literal reconocible, lo
      // exponemos directamente — es lo que hace falta para detectar
      // prefixes y bodies en los scanners.
      const args = asArray(get(node, "arguments"));
      if (args.length === 1) {
        const inner = args[0];
        if (inner) {
          const lit = literalFromNode(inner);
          if (lit.kind !== "unknown") return lit;
        }
      }
      return { kind: "unknown" };
    }
    default:
      return { kind: "unknown" };
  }
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

/**
 * Recorre el árbol de Babel en profundidad y llama a `visit` en cada
 * nodo. Es una DFS sin pruning: visita TODO, incluidos los nodos
 * dentro de arrays y objects.
 *
 * Los `visit` callbacks son los que filtran (deciden si el nodo les
 * interesa). Mantener el walker tonto le deja a los collectores
 * componer lo que necesiten sin tener que pensar en el recorrido.
 */
function walk(body: ReadonlyArray<BabelNode>, visit: (node: BabelNode) => void): void {
  const stack: BabelNode[] = [...body];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    visit(node);
    // Hijos que Babel anida y que queremos visitar también. Los
    // campos `key/value` de object property y `body` de bloques los
    // cubrimos genéricamente leyendo el AST como árbol de unknowns.
    for (const child of collectChildren(node)) stack.push(child);
  }
}

/** Hijos directos del nodo, en el orden en que aparecen en el AST. */
function collectChildren(node: BabelNode): ReadonlyArray<BabelNode> {
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
  return children;
}

// ---------------------------------------------------------------------------
// Safe entry point (a00011 C-7 / B-rev-13)
// ---------------------------------------------------------------------------

/**
 * Variante no lanzadora de `parse`: si Babel rechaza el archivo,
 * devuelve `null` y registra la razón en `diagnostics` (si el array
 * vino) en vez de tragar el error en silencio.
 *
 * El scanner sigue funcionando — un fichero con sintaxis inválida no
 * aborta el scan — pero el fallo queda visible para quien quiera
 * reportarlo (hoy: `IScanResult.diagnostics`).
 */
export function parseModule(
  source: string,
  filename: string,
  diagnostics?: Array<IParseDiagnostic>,
): TSFile | null {
  try {
    return parse(source, filename);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    diagnostics?.push({ file: filename, severity: "error", reason });
    return null;
  }
}