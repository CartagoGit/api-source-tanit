/**
 * `ILanguageIR` — el *Language Intermediate Representation* que los
 * scanners TypeScript-flavored consumen.
 *
 * Hoy los 6 scanners TS (Express, NestJS, Fastify, Hono, Next.js, tRPC)
 * entienden solamente `app.get(...)` y `router.post(...)` — la forma
 * `Identifier + .method` que produce el frontend TS de
 * `packages/core/language-frontends/typescript`. Los proyectos reales
 * mezclan muchos más estilos:
 *
 *   - `this.router.get(...)` — `ThisExpression` + member.
 *   - `api.router.get(...)` — chained member.
 *   - `getRouter().get(...)` — `CallExpression` + member (factory).
 *   - `server["get"](...)` — computed member con string literal.
 *   - `router?.get(...)` — optional chaining.
 *   - `const r = app; r.get(...)` — alias.
 *   - `export { router } from "./router"` — reexport.
 *   - `const M = "get"; app[M](...)` — constant propagation.
 *
 * El frontend TS actual no recoge ninguna de estas variantes porque su
 * `TSMethodCall.callee` es solo `"ident.method"`. Migrar cada scanner
 * por su cuenta duplicaría seis veces la lógica de normalización.
 *
 * `ILanguageIR` es la capa intermedia: los nuevos collectors
 * (`collectMethodCalls`, `collectAliases`, `collectReexports`,
 * `propagateConstants`) producen este shape agnóstico, y los scanners
 * consumen ese shape en vez de mirar el AST de Babel directamente. El
 * frontend TS existente NO se reemplaza — convive, y los scanners
 * nuevos son un módulo aparte en `packages/frameworks/typescript/`.
 *
 * Por qué **aquí** y no en `packages/frameworks/typescript/`:
 *   - El shape es independiente del lenguaje: cualquier collector de
 *     cualquier framework que quiera producir `IRouteCallExpression`
 *     debería poder hacerlo sin reescribir el contrato.
 *   - Los scanners (en `packages/frameworks/scanners/`) ya importan
 *     tipos de `contracts/interfaces/core/` por convención del repo;
 *     meter esto en `frameworks/` introduciría un nuevo eje de
 *     dependencia sin un beneficio claro.
 *
 * No introduce un barrel `packages/contracts/index.ts` — el README de
 * `contracts/` es explícito sobre no añadirlo. Los importadores usan
 * path relativo canónico.
 *
 * Forma parte de a00016 (Frontend TS multi-estilo — LanguageIR).
 * S1 deja solo el shape; S2-S5 montan los collectors y migran los
 * scanners que los consumen.
 */

import type { TSLiteral } from "./language/typescript-frontend-literal.interface.js";

/**
 * Cómo se accede al **receptor** de la llamada.
 *
 * - `"identifier"` — `app.get`. El frontend TS ya cubre este caso.
 * - `"this"` — `this.router.get`. El receptor es `this` (clase).
 * - `"member"` — `api.router.get`. Cadena de propiedades.
 * - `"factory"` — `getRouter().get`. Una `CallExpression` precede
 *   al member: el método es propiedad del *return value* de la
 *   factory.
 * - `"computed"` — `server["get"]`. La propiedad es un string
 *   literal computado en lugar de un identifier.
 * - `"optional"` — `router?.get`. Encadenamiento opcional; el
 *   receptor es el miembro izquierdo del `?.`.
 *
 * Esta enumeración es **del receptor**, no del método: el método va
 * aparte en `method` (o en `resolvedMethod` si la propagación de
 * constantes lo resolvió). Mantener las dos dimensiones separadas es
 * lo que permite que `app["get"]` se clasifique como
 * `receiverKind: "identifier"`, `method: ""`, `resolvedMethod: "get"`.
 */
export type ReceiverKind =
  | "identifier"
  | "this"
  | "member"
  | "factory"
  | "computed"
  | "optional";

/**
 * Una `CallExpression` vista por el colector multi-estilo.
 *
 * Ejemplos y la tupla que producen:
 *
 *   - `app.get("/x")`             → receiverKind="identifier",
 *                                   method="get",
 *                                   callee="app.get".
 *   - `this.router.get("/x")`     → receiverKind="this",
 *                                   method="get",
 *                                   callee="this.router.get".
 *   - `api.router.get("/x")`      → receiverKind="member",
 *                                   method="get",
 *                                   callee="api.router.get".
 *   - `getRouter().get("/x")`     → receiverKind="factory",
 *                                   method="get",
 *                                   callee="getRouter().get".
 *   - `server["get"]("/x")`       → receiverKind="computed",
 *                                   method=""  (no es Identifier),
 *                                   callee='server["get"]'.
 *   - `router?.get("/x")`         → receiverKind="optional",
 *                                   method="get",
 *                                   callee="router.get".
 *   - `const M = "get"; app[M]()` → receiverKind="identifier",
 *                                   method=""  (computed),
 *                                   resolvedMethod="get".
 *
 * `callee` es la cadena completa tal como aparecería en el código
 * (incluyendo el `?.` y los corchetes). Sirve para que los scanners
 * que hoy hacen `callee.split(".")` puedan seguir haciéndolo sin
 * cambiar, y para mensajes de error.
 *
 * `args` son los argumentos de la llamada, ya desempacados por el
 * frontend TS (un `TSLiteral[]`). Los scanners que necesiten tipos
 * más ricos pueden hacer narrowing sobre `args[0].kind`.
 *
 * `range` apunta a los offsets en bytes del nodo `CallExpression`
 * original. Los scanners pueden usarlo para reporting futuro.
 *
 * `resolvedMethod` lo rellena `propagateConstants` (S4) cuando la
 * propiedad era computed y se ha resuelto a un literal. Si
 * `method !== ""`, gana `method`; si `method === ""` y
 * `resolvedMethod !== undefined`, gana `resolvedMethod`. Un scanner
 * que sólo entiende HTTP methods haría `const m =
 * expr.method || expr.resolvedMethod || ""`.
 */
export interface IRouteCallExpression {
  /** Cadena completa del callee (incluye `?.`, corchetes, etc.). */
  readonly callee: string;
  /** Forma del receptor (no del método). */
  readonly receiverKind: ReceiverKind;
  /**
   * El método HTTP cuando es un `Identifier` (`get`, `post`...).
   * Vacío si la propiedad es un string literal computado
   * (`server["get"]`) — en ese caso mirar `resolvedMethod`.
   */
  readonly method: string;
  /** Argumentos de la llamada, en orden. */
  readonly args: ReadonlyArray<TSLiteral>;
  /** Rango en bytes sobre el archivo original. */
  readonly range: {
    readonly file: string;
    readonly start: number;
    readonly end: number;
  };
  /**
   * Si la propagación de constantes resolvió la propiedad, este es
   * el valor literal (`"get"`, `"POST"`, ...). Sólo presente cuando
   * la propiedad era computed y se resolvió.
   */
  readonly resolvedMethod?: string;
}

/**
 * Un `import` visto por el colector de aliases.
 *
 * Cubre las tres formas que interesan a los scanners:
 *   - `import app from "express"` — alias de default.
 *   - `import { Router } from "express"` — alias de named.
 *   - `import * as Router from "express"` — alias de namespace.
 *   - `import { Router as R } from "express"` — alias renombrado.
 *
 * `name` es el **binding local** (lo que aparece en el resto del
 * archivo). El scanner que quiera resolver el origen usa `source`
 * para pedirle al siguiente paso que mire ese módulo.
 */
export interface IImportBinding {
  /** Binding local con el que el resto del archivo se refiere. */
  readonly name: string;
  /** Módulo del que se importa, tal como aparece en el source. */
  readonly source: string;
  /** Rango en bytes del specifier. */
  readonly range: {
    readonly file: string;
    readonly start: number;
    readonly end: number;
  };
}

/**
 * Un `export ... from` visto por el colector de reexports.
 *
 * Cubre:
 *   - `export { router } from "./router"` — reexport de named.
 *   - `export * from "./router"` — reexport de namespace
 *     (en ese caso `name = "*"`).
 *
 * `from` es la ruta del módulo reexportado. Los scanners miran
 * este campo junto con `IImportBinding.source` para resolver
 * routers que viven en otro fichero.
 */
export interface IReexport {
  /** Nombre del símbolo reexportado (o `"*"`). */
  readonly name: string;
  /** Módulo del que se reexporta. */
  readonly from: string;
  /** Rango en bytes del nodo. */
  readonly range: {
    readonly file: string;
    readonly start: number;
    readonly end: number;
  };
}

/**
 * Una constante literal (`const M = "get"`) vista por el colector
 * de propagación.
 *
 * Sólo entran aquí las constantes que se pueden **propagar con
 * certeza**: literales de string, number o boolean directos. Ni
 * concatenaciones (`"GET" + suffix`), ni template literals
 * (`` `get` ``), ni expresiones — esos quedan fuera del contrato
 * y se ignoran silenciosamente. El límite es a propósito: una
 * propagación aproximada generaría falsos positivos y rompería la
 * confianza de los scanners en el shape.
 *
 * `name` es el binding local; el scanner que vea `app[M](...)`
 * mirará aquí para resolver `M` a su `value`.
 */
export interface IConstantBinding {
  /** Binding local (`M` en `const M = "get"`). */
  readonly name: string;
  /** Valor literal — sólo string | number | boolean. */
  readonly value: string | number | boolean;
  /** Rango en bytes del nodo. */
  readonly range: {
    readonly file: string;
    readonly start: number;
    readonly end: number;
  };
}
