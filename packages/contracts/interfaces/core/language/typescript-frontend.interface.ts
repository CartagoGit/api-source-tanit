/**
 * `TSFile` y compañía — el AST normalizado que el frontend TypeScript
 * produce, y sobre el que los 6 scanners JS/TS (Express, NestJS,
 * Fastify, Hono, Next.js, tRPC) escriben adaptadores semánticos.
 *
 * Por qué existe: hasta ahora cada scanner mantenía sus propias regex
 * sobre el código fuente. La forma `app.METHOD(path, handler)` la
 * buscaba Express, `controller.METHOD(path)` la buscaba NestJS, y
 * `<ident>.<method>(<path>, ...)` la buscaba Fastify/Hono/tRPC. Tres
 * regex distintas para una misma idea, cada una con su forma de
 * romperse en multilínea, strings anidadas o `// comentarios`.
 *
 * El frontend resuelve eso: un único parser sintáctico (`@babel/parser`
 * con `plugins: ['typescript']`) produce este AST agnóstico, y los
 * scanners consultan los nodos — `methodCalls`, `decorators`,
 * `assignments` — en vez de regexar el texto.
 *
 * La forma es deliberadamente **mínima**: contiene lo que los seis
 * adapters necesitan, no la totalidad del estandarizado ESTree.
 * Anidar `imports` en `symbols` o seguir referencias cruzadas se hace
 * después, en el adapter, con las herramientas del propio scanner.
 *
 * @see ./parser.ts en `packages/core/language-frontends/typescript/`
 *   para la implementación.
 *
 * (a00010 S7 — slice AST TypeScript)
 */

import type { TSLiteral } from "./typescript-frontend-literal.interface.js";

/**
 * Import del módulo: su fuente, los nombres que arrastra y los
 * bindings locales que recibe cada uno.
 *
 * `import express from "express"` →
 * `{ source: "express", names: ["default"], bindings: [{ local:
 * "express", imported: "default", isDefault: true }] }`.
 * `import { Router } from "express"` →
 * `{ source: "express", names: ["Router"], bindings: [{ local:
 * "Router", imported: "Router", isDefault: false }] }`.
 *
 * `names` es **lo que se importa del módulo origen** (compat, se
 * deriva de `bindings`); el alias local vive en `bindings` — es lo
 * que necesita el futuro grafo de mounts cross-file para saber que
 * `R` en el código es `Router` de `express` (a00011 C-7 / B-rev-12).
 */
export interface TSImportBinding {
  /** Nombre que recibe el binding en el scope local del módulo. */
  readonly local: string;
  /**
   * Nombre exportado por el módulo origen: `"Router"` en
   * `import { Router as R }`, `"default"` en un default import,
   * `"*"` en un namespace import.
   */
  readonly imported: string;
  /** `true` solo en `import x from "..."` (imported es "default"). */
  readonly isDefault: boolean;
  /** `true` solo en `import * as x from "..."` (imported es "*"). */
  readonly isNamespace?: boolean;
}

export interface TSImport {
  readonly source: string;
  /** Nombres tal cual aparecen entre llaves (compat). */
  readonly names: ReadonlyArray<string>;
  /**
   * Bindings locales: qué nombre local recibe cada importado.
   *
   * `import { Router as R } from "express"` →
   * `[{ local: "R", imported: "Router", isDefault: false }]`.
   * `import exp from "express"` →
   * `[{ local: "exp", imported: "default", isDefault: true }]`.
   * `import * as fs from "fs"` →
   * `[{ local: "fs", imported: "*", isDefault: false,
   *    isNamespace: true }]`.
   *
   * `names` se deriva de `bindings` (compat); el grafo de mounts
   * cross-file consume `bindings`, no `names`.
   */
  readonly bindings: ReadonlyArray<TSImportBinding>;
}

/** Una declaración en el módulo: función, clase, variable o método. */
export type TSSymbolKind = "function" | "class" | "variable" | "method";

/**
 * Un símbolo declarado a nivel de módulo o dentro de una clase.
 *
 * `kind: 'method'` aparece en `methods` de una `TSClass` (no en el
 * `symbols` de primer nivel — un método no es un símbolo del módulo).
 * La separación es lo que permite que el adapter decida si le interesa
 * un símbolo por estar en el scope global o por ser el método de un
 * controlador.
 */
export interface TSSymbol {
  readonly name: string;
  readonly kind: TSSymbolKind;
  /** ¿Está exportado del módulo / clase? */
  readonly exported: boolean;
  /** Línea 1-based donde aparece la declaración. */
  readonly line: number;
}

/**
 * Una llamada a método que los scanners miran como si fuera una
 * declaración de ruta.
 *
 * Es la primitiva compartida por los 6 scanners:
 *
 *   - `app.get("/users", handler)` → `callee: "app.get"`.
 *   - `router.post("/users", handler)` → `callee: "router.post"`.
 *   - `controller.Get("users")` (NestJS) → `callee: "controller.Get"`.
 *   - `server.route({ method, path })` → no es un method call, lo
 *     maneja el adapter con un patrón dedicado.
 *
 * `args` solo modela literales y referencias — un argumento puede ser
 * cualquier expresión JS, pero para los scanners lo que importa es:
 *
 *   1. El path (string literal en `args[0]`).
 *   2. El handler (arrow function en `args[1]`, del que se extrae
 *      `bodyRange` para reentrar y leer el cuerpo).
 *
 * Si el primer argumento NO es un string literal, el adapter lo
 * descarta: una ruta sin literal no es una ruta declarable.
 */
export interface TSMethodCall {
  /** Receptor + método, en una sola string (`"app.get"`, `"router.post"`). */
  readonly callee: string;
  /** Argumentos de la llamada, en orden. */
  readonly args: ReadonlyArray<TSLiteral>;
  /** Línea 1-based donde está la llamada. */
  readonly line: number;
  /** Columna 0-based donde empieza la llamada. */
  readonly column: number;
  /**
   * Si la llamada tiene una arrow function como último argumento,
   * este campo lleva el rango (offsets en bytes) del cuerpo. Los
   * adapters lo usan para reentrar al cuerpo con `findInsideRange`.
   */
  readonly bodyRange?: { readonly start: number; readonly end: number };
}

/**
 * Una asignación `nombre = valor` en el módulo.
 *
 * Es la primitiva que captura `const app = express()`,
 * `const router = Router({ prefix: '/api' })` o
 * `const UsersController = class { ... }`. El adapter del framework
 * decide qué nombres le interesan (`app`, `router`, `Controller`…)
 * y qué valor tiene que tener para considerarlo relevante.
 */
export interface TSAssignment {
  readonly name: string;
  readonly value: TSLiteral;
  readonly line: number;
}

/**
 * Un método declarado dentro de una clase. Los adapters de NestJS y
 * tRPC lo usan para encontrar `getX`, `createY`, etc.
 *
 * `args` son los argumentos del decorador que lo etiqueta como
 * endpoint — `@Get('users')` lleva `args[0] = "users"`. Un método sin
 * decorador sigue siendo un símbolo, simplemente no es un endpoint.
 */
export interface TSClassMethod {
  readonly name: string;
  readonly decorators: ReadonlyArray<TSDecorator>;
  readonly args: ReadonlyArray<TSLiteral>;
  readonly line: number;
}

/**
 * Una declaración de clase. Los adapters de NestJS y Next.js la usan
 * para detectar controladores: una clase con `@Controller('/api')`
 * es la raíz de un grupo de endpoints.
 *
 * `methods` se mantiene separado del `symbols` del módulo para que el
 * adapter pueda decidir por separado "esta clase me interesa" y "estos
 * métodos de la clase me interesan".
 */
export interface TSClass {
  readonly name: string;
  readonly exported: boolean;
  readonly decorators: ReadonlyArray<TSDecorator>;
  readonly methods: ReadonlyArray<TSClassMethod>;
  readonly line: number;
}

/**
 * Un decorador sobre una clase o un método.
 *
 * `@Controller('/users')` → `{ name: "Controller", args: ["/users"] }`.
 * `@Get()` → `{ name: "Get", args: [] }`.
 *
 * Los adapters de NestJS lo usan directamente; el resto de scanners lo
 * ignora. Lo importante es que el nombre del decorador (sin el `@`)
 * sobrevive como `name` para que el adapter no tenga que re-parsear la
 * sintaxis del decorador.
 */
export interface TSDecorator {
  readonly name: string;
  readonly args: ReadonlyArray<TSLiteral>;
  /** Nombre del símbolo decorado (clase o método). */
  readonly target: string;
  readonly line: number;
}

/**
 * El AST normalizado de un archivo TS/JS. Es lo que devuelve
 * `parse(source, filename): TSFile`.
 *
 * Las cinco colecciones son **independientes** — no hay punteros
 * cruzados entre ellas. Eso evita que un adapter que solo consume
 * `methodCalls` tenga que cargar el grafo entero, y le da al
 * compilador pie para emitir un `Record & Tuple` futuro si conviene.
 *
 * El orden dentro de cada colección es el del archivo (top-down):
 * desde a00011 C-7 (B-rev-11) el parser lo garantiza ordenando cada
 * colección por `(line, column)` ascendente al cerrar el parse — es
 * determinista, independiente del orden del walker, y es el orden
 * natural para reportar errores o presentar al usuario.
 */
export interface TSFile {
  readonly imports: ReadonlyArray<TSImport>;
  /** Símbolos declarados a nivel de módulo (no incluye métodos de clase). */
  readonly symbols: ReadonlyArray<TSSymbol>;
  /** Clases declaradas a nivel de módulo. */
  readonly classes: ReadonlyArray<TSClass>;
  /** Llamadas `<ident>.<method>(...)` que parecen declaraciones de ruta. */
  readonly methodCalls: ReadonlyArray<TSMethodCall>;
  /** Asignaciones `<ident> = <expr>`. */
  readonly assignments: ReadonlyArray<TSAssignment>;
  /** Decoradores sobre clases o métodos del módulo. */
  readonly decorators: ReadonlyArray<TSDecorator>;
  /**
   * Nombre del archivo tal como se pasó a `parse()`. Se adjunta al AST
   * para que los adapters puedan reportar errores y los scanners
   * puedan enseñárselo al usuario sin tener que pasarlo aparte.
   */
  readonly filename: string;
}