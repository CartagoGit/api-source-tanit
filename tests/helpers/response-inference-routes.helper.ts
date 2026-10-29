/**
 * The routes each framework's scanner reports over its **reference
 * fixture** — the denominator of the response-inference coverage
 * (proposal `r00020` S3).
 *
 * ## Why the routes are written down
 *
 * The coverage reporter answers "what percentage of the operations
 * ended up with a response?", and the denominator is the routes the
 * scanner found. Writing them down — instead of asking the scanner
 * again — keeps the measurement **reproducible**: the numbers in
 * `RESPONSE_INFERENCE_COVERAGE_BASELINE` can be recomputed by anyone
 * with this file, without a scanner in the loop.
 *
 * ## How the list stays true
 *
 * `tests/frameworks/response-inference-routes.spec.ts` runs each
 * scanner over its fixture and compares what it reports with what is
 * written here. When a scanner changes — a new route, a renamed
 * prefix — that spec fails, and the baseline has to be measured
 * again. That is the whole point of writing the list down.
 */
import type { ResponseInferrerId } from "../../packages/contracts/constants/core/response-inference.constant.js";

/**
 * One route, as the scanner reports it.
 */
export interface IReferenceRoute {
  /** HTTP method, uppercase. */
  readonly method: string;
  /** The URI with the prefixes the scanner applied. */
  readonly uri: string;
  /** The URI as the code declares it. */
  readonly rawUri: string;
  /** The file the route was declared in, relative to the fixture. */
  readonly sourceFile: string;
  /** 1-based line of the declaration. */
  readonly lineNumber: number;
  /** The controller the route dispatches to, when the scanner resolved it. */
  readonly controllerClass?: string;
  /** The action the route dispatches to, when the scanner resolved it. */
  readonly actionName?: string;
}

/**
 * The reference routes of every inferrer that has a reference
 * fixture.
 */
export const REFERENCE_ROUTES: Readonly<
  Partial<Record<ResponseInferrerId, ReadonlyArray<IReferenceRoute>>>
> = {
  nestjs: [
    { method: "GET", uri: "/users", rawUri: "/users", sourceFile: "src/users.controller.ts", lineNumber: 11 },
    { method: "POST", uri: "/users", rawUri: "/users", sourceFile: "src/users.controller.ts", lineNumber: 17 },
  ],
  fastify: [
    { method: "GET", uri: "/users", rawUri: "/users", sourceFile: "src/server.ts", lineNumber: 5 },
    { method: "POST", uri: "/users", rawUri: "/users", sourceFile: "src/server.ts", lineNumber: 25 },
    { method: "GET", uri: "/health", rawUri: "/health", sourceFile: "src/server.ts", lineNumber: 49 },
  ],
  express: [
    { method: "GET", uri: "/users", rawUri: "/users", sourceFile: "src/app.ts", lineNumber: 5 },
    { method: "POST", uri: "/users", rawUri: "/users", sourceFile: "src/app.ts", lineNumber: 9 },
    { method: "GET", uri: "/users/:id", rawUri: "/users/:id", sourceFile: "src/app.ts", lineNumber: 13 },
    { method: "GET", uri: "/health", rawUri: "/health", sourceFile: "src/app.ts", lineNumber: 18 },
  ],
  "laravel-resources": [
    {
      method: "GET",
      uri: "/api/users",
      rawUri: "/users",
      sourceFile: "routes/api.php",
      lineNumber: 6,
      controllerClass: "App\\Http\\Controllers\\UserController",
      actionName: "index",
    },
    {
      method: "POST",
      uri: "/api/users",
      rawUri: "/users",
      sourceFile: "routes/api.php",
      lineNumber: 7,
      controllerClass: "App\\Http\\Controllers\\UserController",
      actionName: "store",
    },
    {
      method: "GET",
      uri: "/api/users/{user}",
      rawUri: "/users/{user}",
      sourceFile: "routes/api.php",
      lineNumber: 8,
      controllerClass: "App\\Http\\Controllers\\UserController",
      actionName: "show",
    },
  ],
  gin: [
    { method: "GET", uri: "/users", rawUri: "/users", sourceFile: "main.go", lineNumber: 0 },
    { method: "POST", uri: "/users", rawUri: "/users", sourceFile: "main.go", lineNumber: 0 },
    { method: "GET", uri: "/users/:id", rawUri: "/users/:id", sourceFile: "main.go", lineNumber: 0 },
    { method: "GET", uri: "/health", rawUri: "/health", sourceFile: "main.go", lineNumber: 0 },
  ],
  "rails-render": [
    { method: "GET", uri: "/api/users", rawUri: "users", sourceFile: "config/routes.rb", lineNumber: 3, actionName: "index" },
    { method: "POST", uri: "/api/users", rawUri: "users", sourceFile: "config/routes.rb", lineNumber: 3, actionName: "create" },
    { method: "GET", uri: "/api/users/{id}", rawUri: "users/{id}", sourceFile: "config/routes.rb", lineNumber: 3, actionName: "show" },
    { method: "PUT", uri: "/api/users/{id}", rawUri: "users/{id}", sourceFile: "config/routes.rb", lineNumber: 3, actionName: "update" },
    { method: "PATCH", uri: "/api/users/{id}", rawUri: "users/{id}", sourceFile: "config/routes.rb", lineNumber: 3, actionName: "update" },
    { method: "DELETE", uri: "/api/users/{id}", rawUri: "users/{id}", sourceFile: "config/routes.rb", lineNumber: 3, actionName: "destroy" },
    { method: "GET", uri: "/posts", rawUri: "posts", sourceFile: "config/routes.rb", lineNumber: 6, actionName: "index" },
    { method: "POST", uri: "/posts", rawUri: "posts", sourceFile: "config/routes.rb", lineNumber: 6, actionName: "create" },
    { method: "GET", uri: "/posts/{id}", rawUri: "posts/{id}", sourceFile: "config/routes.rb", lineNumber: 6, actionName: "show" },
    { method: "PUT", uri: "/posts/{id}", rawUri: "posts/{id}", sourceFile: "config/routes.rb", lineNumber: 6, actionName: "update" },
    { method: "PATCH", uri: "/posts/{id}", rawUri: "posts/{id}", sourceFile: "config/routes.rb", lineNumber: 6, actionName: "update" },
    { method: "DELETE", uri: "/posts/{id}", rawUri: "posts/{id}", sourceFile: "config/routes.rb", lineNumber: 6, actionName: "destroy" },
  ],
  "ktor-respond": [
    { method: "GET", uri: "/users", rawUri: "/users", sourceFile: "src/main.kt", lineNumber: 13 },
    { method: "GET", uri: "/users/{id}", rawUri: "/users/{id}", sourceFile: "src/main.kt", lineNumber: 18 },
    { method: "POST", uri: "/users", rawUri: "/users", sourceFile: "src/main.kt", lineNumber: 27 },
    { method: "DELETE", uri: "/users/{id}", rawUri: "/users/{id}", sourceFile: "src/main.kt", lineNumber: 31 },
  ],
};
