/**
 * `ILanguageIR` — the *Language Intermediate Representation* that the
 * TypeScript-flavored scanners consume.
 *
 * Today the 6 TS scanners (Express, NestJS, Fastify, Hono, Next.js, tRPC)
 * only understand `app.get(...)` and `router.post(...)` — the
 * `Identifier + .method` shape produced by the TS frontend at
 * `packages/core/language-frontends/typescript`. Real projects mix
 * many more styles:
 *
 *   - `this.router.get(...)` — `ThisExpression` + member.
 *   - `api.router.get(...)` — chained member.
 *   - `getRouter().get(...)` — `CallExpression` + member (factory).
 *   - `server["get"](...)` — computed member with string literal.
 *   - `router?.get(...)` — optional chaining.
 *   - `const r = app; r.get(...)` — alias.
 *   - `export { router } from "./router"` — reexport.
 *   - `const M = "get"; app[M](...)` — constant propagation.
 *
 * The current TS frontend does not collect any of these variants because
 * its `TSMethodCall.callee` is only `"ident.method"`. Migrating each
 * scanner separately would duplicate the normalization logic six times.
 *
 * `ILanguageIR` is the intermediate layer: the new collectors
 * (`collectMethodCalls`, `collectAliases`, `collectReexports`,
 * `propagateConstants`) produce this agnostic shape, and the scanners
 * consume that shape instead of looking at the Babel AST directly. The
 * existing TS frontend is NOT replaced — they coexist, and the new
 * scanners live as a separate module in `packages/frameworks/typescript/`.
 *
 * Why **here** and not in `packages/frameworks/typescript/`:
 *   - The shape is language-independent: any collector from any
 *     framework that wants to produce `IRouteCallExpression` should
 *     be able to do so without rewriting the contract.
 *   - The scanners (in `packages/frameworks/scanners/`) already import
 *     types from `contracts/interfaces/core/` by repo convention;
 *     putting this in `frameworks/` would introduce a new dependency
 *     axis without a clear benefit.
 *
 * It does not introduce a barrel `packages/contracts/index.ts` — the
 * `contracts/` README is explicit about not adding one. Importers use
 * canonical relative paths.
 *
 * Part of a00016 (Multi-style TS frontend — LanguageIR).
 * S1 ships only the shape; S2-S5 build the collectors and migrate the
 * scanners that consume them.
 */

import type { TSLiteral } from "./language/typescript-frontend-literal.interface.js";

/**
 * How the **receiver** of the call is accessed.
 *
 * - `"identifier"` — `app.get`. The TS frontend already covers this case.
 * - `"this"` — `this.router.get`. The receiver is `this` (class).
 * - `"member"` — `api.router.get`. Chain of properties.
 * - `"factory"` — `getRouter().get`. A `CallExpression` precedes the
 *   member: the method is a property of the factory's *return value*.
 * - `"computed"` — `server["get"]`. The property is a computed string
 *   literal instead of an identifier.
 * - `"optional"` — `router?.get`. Optional chaining; the receiver is
 *   the left-hand member of the `?.`.
 *
 * This enumeration belongs to the **receiver**, not the method: the
 * method lives separately in `method` (or in `resolvedMethod` if
 * constant propagation resolved it). Keeping the two dimensions
 * separate is what allows `app["get"]` to classify as
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
 * A `CallExpression` as seen by the multi-style collector.
 *
 * Examples and the tuple they produce:
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
 *                                   method=""  (not an Identifier),
 *                                   callee='server["get"]'.
 *   - `router?.get("/x")`         → receiverKind="optional",
 *                                   method="get",
 *                                   callee="router.get".
 *   - `const M = "get"; app[M]()` → receiverKind="identifier",
 *                                   method=""  (computed),
 *                                   resolvedMethod="get".
 *
 * `callee` is the full string as it would appear in code (including
 * the `?.` and brackets). It lets scanners that today do
 * `callee.split(".")` keep doing so unchanged, and serves for error
 * messages.
 *
 * `args` are the call's arguments, already unpacked by the TS
 * frontend (a `TSLiteral[]`). Scanners that need richer types can
 * narrow on `args[0].kind`.
 *
 * `range` points at the byte offsets of the original `CallExpression`
 * node. Scanners can use it for future reporting.
 *
 * `resolvedMethod` is filled in by `propagateConstants` (S4) when
 * the property was computed and was resolved to a literal. If
 * `method !== ""`, `method` wins; if `method === ""` and
 * `resolvedMethod !== undefined`, `resolvedMethod` wins. A scanner
 * that only understands HTTP methods would do `const m =
 * expr.method || expr.resolvedMethod || ""`.
 */
export interface IRouteCallExpression {
  /** Full callee string (includes `?.`, brackets, etc.). */
  readonly callee: string;
  /** Shape of the receiver (not of the method). */
  readonly receiverKind: ReceiverKind;
  /**
   * The HTTP method when it is an `Identifier` (`get`, `post`...).
   * Empty when the property is a computed string literal
   * (`server["get"]`) — in that case look at `resolvedMethod`.
   */
  readonly method: string;
  /** Call arguments, in order. */
  readonly args: ReadonlyArray<TSLiteral>;
  /** Byte range in the original file. */
  readonly range: {
    readonly file: string;
    readonly start: number;
    readonly end: number;
  };
  /**
   * If constant propagation resolved the property, this is the literal
   * value (`"get"`, `"POST"`, ...). Only present when the property
   * was computed and was resolved.
   */
  readonly resolvedMethod?: string;
}

/**
 * An `import` as seen by the aliases collector.
 *
 * Covers the three forms that matter to scanners:
 *   - `import app from "express"` — default alias.
 *   - `import { Router } from "express"` — named alias.
 *   - `import * as Router from "express"` — namespace alias.
 *   - `import { Router as R } from "express"` — renamed alias.
 *
 * `name` is the **local binding** (what appears in the rest of the
 * file). The scanner that wants to resolve the origin uses `source`
 * to ask the next step to look at that module.
 */
export interface IImportBinding {
  /** Local binding the rest of the file refers to. */
  readonly name: string;
  /** Module imported from, as it appears in source. */
  readonly source: string;
  /** Byte range of the specifier. */
  readonly range: {
    readonly file: string;
    readonly start: number;
    readonly end: number;
  };
}

/**
 * An `export ... from` as seen by the reexports collector.
 *
 * Covers:
 *   - `export { router } from "./router"` — named reexport.
 *   - `export * from "./router"` — namespace reexport
 *     (in that case `name = "*"`).
 *
 * `from` is the path of the reexported module. Scanners look at this
 * field together with `IImportBinding.source` to resolve routers that
 * live in another file.
 */
export interface IReexport {
  /** Name of the reexported symbol (or `"*"`). */
  readonly name: string;
  /** Module reexported from. */
  readonly from: string;
  /** Byte range of the node. */
  readonly range: {
    readonly file: string;
    readonly start: number;
    readonly end: number;
  };
}

/**
 * A literal constant (`const M = "get"`) as seen by the propagation
 * collector.
 *
 * Only constants that can be **propagated with certainty** enter here:
 * direct string, number or boolean literals. No concatenations
 * (`"GET" + suffix`), no template literals (`` `get` ``), no
 * expressions — those stay out of the contract and are silently
 * ignored. The limit is deliberate: an approximate propagation would
 * generate false positives and break the scanners' trust in the shape.
 *
 * `name` is the local binding; the scanner that sees `app[M](...)`
 * will look here to resolve `M` to its `value`.
 */
export interface IConstantBinding {
  /** Local binding (`M` in `const M = "get"`). */
  readonly name: string;
  /** Literal value — only string | number | boolean. */
  readonly value: string | number | boolean;
  /** Byte range of the node. */
  readonly range: {
    readonly file: string;
    readonly start: number;
    readonly end: number;
  };
}
