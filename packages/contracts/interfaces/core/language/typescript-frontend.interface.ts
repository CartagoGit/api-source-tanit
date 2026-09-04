/**
 * `TSFile` and friends — the normalized AST produced by the TypeScript
 * frontend, on top of which the 6 JS/TS scanners (Express, NestJS,
 * Fastify, Hono, Next.js, tRPC) write semantic adapters.
 *
 * Why it exists: until now each scanner maintained its own regexes
 * over the source code. The `app.METHOD(path, handler)` shape was
 * searched by Express, `controller.METHOD(path)` was searched by
 * NestJS, and `<ident>.<method>(<path>, ...)` was searched by
 * Fastify/Hono/tRPC. Three different regexes for the same idea, each
 * with its own way of breaking across multiline, nested strings or
 * `// comments`.
 *
 * The frontend solves that: a single syntactic parser
 * (`@babel/parser` with `plugins: ['typescript']`) produces this
 * agnostic AST, and the scanners query the nodes — `methodCalls`,
 * `decorators`, `assignments` — instead of regexing the text.
 *
 * The shape is deliberately **minimal**: it contains what the six
 * adapters need, not the entirety of the standardized ESTree.
 * Nesting `imports` inside `symbols` or following cross-references
 * happens later, in the adapter, using the scanner's own tools.
 *
 * @see ./parser.ts in `packages/core/language-frontends/typescript/`
 *   for the implementation.
 *
 * (a00010 S7 — TypeScript AST slice)
 */

import type { TSLiteral } from "./typescript-frontend-literal.interface.js";

/**
 * Module import: its source, the names it carries and the local
 * bindings each one receives.
 *
 * `import express from "express"` →
 * `{ source: "express", names: ["default"], bindings: [{ local:
 * "express", imported: "default", isDefault: true }] }`.
 * `import { Router } from "express"` →
 * `{ source: "express", names: ["Router"], bindings: [{ local:
 * "Router", imported: "Router", isDefault: false }] }`.
 *
 * `names` is **what is imported from the source module** (compat, it
 * is derived from `bindings`); the local alias lives in `bindings`
 * — it is what the future cross-file mounts graph needs to know that
 * `R` in code is `Router` from `express` (a00011 C-7 / B-rev-12).
 */
export interface TSImportBinding {
  /** Name the binding receives in the module's local scope. */
  readonly local: string;
  /**
   * Name exported by the source module: `"Router"` in
   * `import { Router as R }`, `"default"` in a default import,
   * `"*"` in a namespace import.
   */
  readonly imported: string;
  /** `true` only in `import x from "..."` (imported is "default"). */
  readonly isDefault: boolean;
  /** `true` only in `import * as x from "..."` (imported is "*"). */
  readonly isNamespace?: boolean;
}

export interface TSImport {
  readonly source: string;
  /** Names as they appear between braces (compat). */
  readonly names: ReadonlyArray<string>;
  /**
   * Local bindings: which local name each imported symbol receives.
   *
   * `import { Router as R } from "express"` →
   * `[{ local: "R", imported: "Router", isDefault: false }]`.
   * `import exp from "express"` →
   * `[{ local: "exp", imported: "default", isDefault: true }]`.
   * `import * as fs from "fs"` →
   * `[{ local: "fs", imported: "*", isDefault: false,
   *    isNamespace: true }]`.
   *
   * `names` is derived from `bindings` (compat); the cross-file
   * mounts graph consumes `bindings`, not `names`.
   */
  readonly bindings: ReadonlyArray<TSImportBinding>;
}

/** A declaration in the module: function, class, variable or method. */
export type TSSymbolKind = "function" | "class" | "variable" | "method";

/**
 * A symbol declared at module level or inside a class.
 *
 * `kind: 'method'` appears in `methods` of a `TSClass` (not in the
 * top-level `symbols` — a method is not a module-level symbol). The
 * separation is what lets the adapter decide whether it cares about
 * a symbol because it lives in the global scope or because it is the
 * method of a controller.
 */
export interface TSSymbol {
  readonly name: string;
  readonly kind: TSSymbolKind;
  /** Whether it is exported from the module / class. */
  readonly exported: boolean;
  /** 1-based line where the declaration appears. */
  readonly line: number;
}

/**
 * A method call that scanners treat as if it were a route
 * declaration.
 *
 * It is the primitive shared by the 6 scanners:
 *
 *   - `app.get("/users", handler)` → `callee: "app.get"`.
 *   - `router.post("/users", handler)` → `callee: "router.post"`.
 *   - `controller.Get("users")` (NestJS) → `callee: "controller.Get"`.
 *   - `server.route({ method, path })` → not a method call, the
 *     adapter handles it with a dedicated pattern.
 *
 * `args` only models literals and references — an argument can be
 * any JS expression, but for scanners what matters is:
 *
 *   1. The path (string literal at `args[0]`).
 *   2. The handler (arrow function at `args[1]`, from which
 *      `bodyRange` is extracted to re-enter and read the body).
 *
 * If the first argument is NOT a string literal, the adapter
 * discards it: a route without a literal is not a declarable route.
 */
export interface TSMethodCall {
  /** Receiver + method, in a single string (`"app.get"`, `"router.post"`). */
  readonly callee: string;
  /** Arguments of the call, in order. */
  readonly args: ReadonlyArray<TSLiteral>;
  /** 1-based line where the call is. */
  readonly line: number;
  /** 0-based column where the call starts. */
  readonly column: number;
  /**
   * If the call has an arrow function as its last argument, this
   * field carries the range (byte offsets) of the body. Adapters
   * use it to re-enter the body with `findInsideRange`.
   */
  readonly bodyRange?: { readonly start: number; readonly end: number };
}

/**
 * A `name = value` assignment in the module.
 *
 * It is the primitive that captures `const app = express()`,
 * `const router = Router({ prefix: '/api' })` or
 * `const UsersController = class { ... }`. The framework's adapter
 * decides which names it cares about (`app`, `router`, `Controller`…)
 * and what value they must hold to be considered relevant.
 */
export interface TSAssignment {
  readonly name: string;
  readonly value: TSLiteral;
  readonly line: number;
}

/**
 * A method declared inside a class. The NestJS and tRPC adapters
 * use it to find `getX`, `createY`, etc.
 *
 * `args` are the arguments of the decorator that tags it as an
 * endpoint — `@Get('users')` carries `args[0] = "users"`. A method
 * without a decorator is still a symbol, it just is not an endpoint.
 */
export interface TSClassMethod {
  readonly name: string;
  readonly decorators: ReadonlyArray<TSDecorator>;
  readonly args: ReadonlyArray<TSLiteral>;
  readonly line: number;
}

/**
 * A class declaration. The NestJS and Next.js adapters use it to
 * detect controllers: a class with `@Controller('/api')` is the
 * root of a group of endpoints.
 *
 * `methods` is kept separate from the module's `symbols` so the
 * adapter can independently decide "this class interests me" and
 * "these methods of the class interest me".
 */
export interface TSClass {
  readonly name: string;
  readonly exported: boolean;
  readonly decorators: ReadonlyArray<TSDecorator>;
  readonly methods: ReadonlyArray<TSClassMethod>;
  readonly line: number;
}

/**
 * A decorator on a class or method.
 *
 * `@Controller('/users')` → `{ name: "Controller", args: ["/users"] }`.
 * `@Get()` → `{ name: "Get", args: [] }`.
 *
 * The NestJS adapters use it directly; the rest of scanners ignore
 * it. The important part is that the decorator's name (without the
 * `@`) survives as `name` so the adapter does not have to re-parse
 * the decorator's syntax.
 */
export interface TSDecorator {
  readonly name: string;
  readonly args: ReadonlyArray<TSLiteral>;
  /** Name of the decorated symbol (class or method). */
  readonly target: string;
  readonly line: number;
}

/**
 * The normalized AST of a TS/JS file. It is what
 * `parse(source, filename): TSFile` returns.
 *
 * The five collections are **independent** — there are no cross
 * pointers between them. That avoids forcing an adapter that only
 * consumes `methodCalls` to load the entire graph, and gives the
 * compiler room to emit a future `Record & Tuple` if it helps.
 *
 * The order within each collection is the file's order (top-down):
 * since a00011 C-7 (B-rev-11) the parser guarantees it by sorting
 * each collection by `(line, column)` ascending when the parse
 * closes — it is deterministic, independent of the walker's order,
 * and is the natural order for reporting errors or showing to the
 * user.
 */
export interface TSFile {
  readonly imports: ReadonlyArray<TSImport>;
  /** Symbols declared at module level (does not include class methods). */
  readonly symbols: ReadonlyArray<TSSymbol>;
  /** Classes declared at module level. */
  readonly classes: ReadonlyArray<TSClass>;
  /** `<ident>.<method>(...)` calls that look like route declarations. */
  readonly methodCalls: ReadonlyArray<TSMethodCall>;
  /** `<ident> = <expr>` assignments. */
  readonly assignments: ReadonlyArray<TSAssignment>;
  /** Decorators on classes or methods in the module. */
  readonly decorators: ReadonlyArray<TSDecorator>;
  /**
   * File name as passed to `parse()`. Attached to the AST so that
   * adapters can report errors and scanners can show it to the user
   * without having to pass it separately.
   */
  readonly filename: string;
}