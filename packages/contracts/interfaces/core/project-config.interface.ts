/**
 * Project configuration interface.
 *
 * Every project using this package must provide a `ProjectConfig`
 * object with its own values (name, variables, route prefixes, zones,
 * etc.). The package itself contains NO project values: only this
 * interface and the services that consume it.
 *
 * Minimal example:
 * ```ts
 * import type { ProjectConfig } from "./contracts/project-config.interface.js";
 *
 * export const config: ProjectConfig = {
 *   name: "my-api",
 *   collectionName: "My API (Catalog)",
 *   collectionDescription: "Postman collection for My API.",
 *   baseUrl: "http://localhost",
 *   variables: [
 *     { key: "baseUrl", value: "http://localhost", type: "string" },
 *     { key: "token", value: "", type: "string" },
 *   ],
 *   filePrefixes: {},
 *   zones: [],
 *   zoneOrder: [],
 *   defaultZone: "Other",
 *   authDescriptions: {},
 *   loginEndpointName: "Login",
 * };
 * ```
 *
 * The default `baseUrl` is the **origin** (`DEFAULT_BASE_URL`). The
 * `/api` suffix only appears when one of the sources documented in
 * `BASE_PATH_SOURCES` contributes it -- see `a00012 S4`.
 */
import type { PostmanVariable } from "./postman.interface.js";

/**
 * Complete configuration a project must provide.
 */
export interface ProjectConfig {
  /** Short project name (used as basename of the output JSON). */
  name: string;

  /** Display name of the collection in Postman (`info.name`). */
  collectionName: string;

  /**
   * Fixed collection ID in Postman (UUID). Optional.
   *
   * If not declared, it is derived deterministically from the project
   * name, so regenerating and re-importing UPDATES the existing
   * collection instead of creating a copy.
   *
   * Pin it manually if you rename the project, move it to a different
   * folder and want to keep the collection you already have in Postman.
   */
  collectionId?: string;

  /** Collection description (`info.description`). */
  collectionDescription: string;

  /**
   * Default base URL (pure origin; the `/api` suffix is only added
   * when an explicit source contributes it -- see file header).
   */
  baseUrl: string;

  /** Postman collection variables. */
  variables: PostmanVariable[];

  /**
   * Map of routes file -> external prefixes applied by its
   * ServiceProvider. If a file is not listed here, `["api"]` is assumed.
   *
   * Example:
   * ```ts
   * {
   *   "routes/api.php": [],
   *   "routes/orders.php": ["api", "orders"],
   * }
   * ```
   */
  filePrefixes: Record<string, string[]>;

  /**
   * URI prefixes that define logical zones. Priority order: the first
   * match wins.
   *
   * Example:
   * ```ts
   * [
   *   ["login", "Auth"],
   *   ["certificates", "Auth"],
   *   ["products", "Resources"],
   * ]
   * ```
   */
  zones: ReadonlyArray<readonly [string, string]>;

  /** Order in which zones are printed in list/stats. */
  zoneOrder: string[];

  /** Default zone when an endpoint does not match any prefix. */
  defaultZone: string;

  /**
   * Reusable descriptions for the `description` field of requests.
   * Free-form key (e.g. "sanctumToken", "jwtToken", "externalApiKey").
   */
  authDescriptions: Record<string, string>;

  /**
   * Name of the login endpoint for the auto-token script. If no
   * endpoint with this name exists, the auto-token script is not
   * applied.
   */
  loginEndpointName: string;

  /**
   * Special URI grouping rules. If a URI starts with one of these
   * prefixes, it is grouped under the given key instead of using the
   * first segment.
   *
   * Example:
   * ```ts
   * {
   *   "tol/tecdoc": "tol/tecdoc",
   *   "external-providers": "external-providers",
   * }
   * ```
   */
  uriGroupOverrides?: Record<string, string>;

  /**
   * Additional environments to generate alongside the collection. If
   * empty or undefined, no environment is generated. Each `baseUrl`
   * replaces the config one only for that environment.
   *
   * To generate dev/staging/prod automatically, use
   * `defaultEnvironments(baseUrl)` from
   * `services/environment-builder.service.ts`.
   */
  environments?: ReadonlyArray<{
    name: string;
    color?: string;
    overrides?: Record<string, string>;
  }>;

  /**
   * Dot-path where the token comes from in the login response:
   * `data.access_token` (Sanctum/Laravel Passport), `access_token`
   * (tymon/jwt-auth), `token`...
   *
   * Optional. If not declared, the generated script tries the usual
   * paths at runtime and uses the first one that returns a non-empty
   * string. Only declare it if your API returns the token in an
   * unusual location.
   */
  tokenResponsePath?: string;
}
