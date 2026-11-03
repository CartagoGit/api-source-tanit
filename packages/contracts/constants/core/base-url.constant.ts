/**
 * The default origin used when no evidence supports a base path.
 *
 * Before this constant existed, five files (init, the loader's
 * zero-config branch, the environment builder, the param inferrer and
 * the project-config docstring) hardcoded `http://localhost/api`.
 * A Postman collection for an Express, Flask, Gin or FastAPI project
 * therefore ended every URL as `http://localhost/api/users` even when
 * the framework never declared a global `/api` prefix — the user would
 * import the collection, run it, and get a 404 on every request whose
 * real route was just `/users`.
 *
 * The fix lives in `buildZeroConfig` (see
 * `packages/core/discovery/project-loader.service.ts`) and the slice
 * that produced it is `a00012 S4`: `DEFAULT_BASE_URL` is `origin` with
 * no path, and a trailing path only appears when one of the documented
 * sources (route, framework, explicit config, OpenAPI servers, or
 * `POSTMAN_BASE_PATH`) contributes it.
 *
 * Error messages are in English to match the package's output language
 * (the `lint:output-language` gate enforces it project-wide).
 */

/**
 * Origin used when no source contributes a path.
 *
 * No trailing slash, no path: it is the origin that the user's
 * Postman environment will resolve against, full stop. If you ever
 * need a default that includes a path, you don't need this — one of
 * the documented sources above will contribute it.
 */
export const DEFAULT_BASE_URL = "http://localhost";

/**
 * Env var a caller can set to contribute a base path explicitly.
 *
 * `buildZeroConfig` appends it to `DEFAULT_BASE_URL` when present.
 * The variable name is part of the contract — a project that ships a
 * `.env` template with `POSTMAN_BASE_PATH=/api` is opting into the
 * prefix; renaming the variable would silently regress those projects.
 */
export const BASE_PATH_ENV_VAR = "POSTMAN_BASE_PATH";
/**
 * The collection's base-URL VARIABLE, in both spellings.
 *
 * `{{baseUrl}}` is the single-service form; r00019 added the
 * per-operation `{{baseUrl_<serviceId>}}` so a merged collection can
 * point each request at its own service.
 *
 * One definition, because matching only the bare name was a live bug in
 * two places at once, and the two failed differently: `pathToSegments`
 * left the variable in the path, so every route missed the generator's
 * parity check and generation aborted; the collection builder's folder
 * grouping returned the variable as the folder KEY, collapsing nine
 * requests into a single folder named after a temp directory. A third
 * copy in `auth-flow` used a broader pattern and happened to escape.
 *
 * Anchored at the start on purpose: a variable in the MIDDLE of a path
 * is a path parameter, not a host, and must survive.
 */
export const BASE_URL_VARIABLE = /^\{\{baseUrl(?:_[^}]*)?\}\}/;
