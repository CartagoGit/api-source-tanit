/**
 * Helpers to normalize URIs before comparing.
 *
 * URIs have five forms that must match:
 *   - Laravel: `{client}` or `{client:code}`
 *   - Express: `:clientId`
 *   - FastAPI: `{client_id}` (same format as Laravel)
 *   - Django:  `<id>`, `<int:id>`, `<str:slug>`, `<uuid:token>`
 *   - Postman: `{{clientId}}`
 *
 * `normalizeForComparison` reduces any parameterized token to `:p`
 * (same marker regardless of name). This is enough for the vast
 * majority of cases. The exception are endpoints that differ only by
 * parameter name and by a `where()` regex in Laravel (e.g.
 * `/search/{historic}` vs `/search/{plate}`); these are documented in
 * the catalog with different names and the generation script reports
 * them as separate requests even though they normalize the same.
 */
export function normalizeForComparison(uri: string): string {
  return uri
    .replace(/\{\{[^}]+\}\}/g, ":p") // {{something}} → :p
    .replace(/\{[^}]+\}/g, ":p") // {something} or {something:regex} → :p
    .replace(/<[a-zA-Z_][\w]*:[a-zA-Z_][\w]*>/g, ":p") // <int:id> → :p
    .replace(/<[a-zA-Z_][\w]*>/g, ":p") // <id> → :p
    .replace(/:[a-zA-Z_][\w]*/g, ":p") // :id (Express) → :p
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")
    .replace(/^\//, "");
}

/** Strips the `api/` prefix added by RouteServiceProvider. */
export function stripApiPrefix(uri: string): string {
  return uri.startsWith("api/") ? uri.slice(4) : uri;
}
/**
 * Joins the segments of a path (class/group prefix + method path) into
 * a normalized URI.
 *
 * The trailing slash is preserved **only if the last non-empty segment
 * declared it**. That distinction matters:
 *
 *   - Django: `path("<int:id>/", …)` brings it on purpose. With
 *     `APPEND_SLASH = True` (the default), calling without it returns
 *     a 301 and a POST loses its body on the redirect.
 *   - NestJS, Spring Boot, ASP.NET and Flask: `@Controller("orders")` +
 *     `@Get()` concatenated `"orders" + "/" + ""` and produced `orders/`.
 *     There the slash is an artifact, not a decision.
 */
export function joinRoutePath(...segments: string[]): string {
  // A lone `"/"` as the first segment means "the path is absolute"; it
  // brings no content but does decide the leading slash.
  const absolute = segments[0] === "/" || (segments[0]?.startsWith("/") ?? false);
  const meaningful = segments.filter((s) => s !== "" && s !== "/");
  if (meaningful.length === 0) return "/";

  const keepTrailingSlash = meaningful[meaningful.length - 1]!.endsWith("/");
  const joined = meaningful.join("/").replace(/\/+/g, "/");
  const withLeading = absolute && !joined.startsWith("/") ? `/${joined}` : joined;
  const withoutTrailing =
    withLeading.length > 1 ? withLeading.replace(/\/$/, "") : withLeading;

  return keepTrailingSlash && withoutTrailing !== "/"
    ? `${withoutTrailing}/`
    : withoutTrailing;
}

// ---------------------------------------------------------------------------
// Grouping endpoints into folders
//
// Used to live in the Laravel route parser, but they only look at the URI:
// the first meaningful segment becomes the folder name. That holds the
// same for Gin or FastAPI, so they belong to the core.
// ---------------------------------------------------------------------------

/**
 * Returns the logical top-level group of a URI (first meaningful
 * segment). For example:
 *
 *   "api/customers"             → "customers"
 *   "api/customers/{customer}"  → "customers"
 *   "api/erp/products"          → "erp"
 *   "api/orders/history"        → "orders"
 *   "alive" / "login"           → "login" / "alive"
 *
 * If the URI starts with `api/`, it is skipped. Special cases are
 * configured via `uriGroupOverrides` (e.g. `{ "tol/tecdoc": "tol/tecdoc" }`).
 *
 * @param uri URI to analyze.
 * @param uriGroupOverrides Map of prefix → group key (from `ProjectConfig`).
 */
export function topGroupFor(
  uri: string,
  uriGroupOverrides: Record<string, string> = {},
): string {
  let u = uri;
  // Strip leading `/api/` or `api/` (Laravel adds `api/` by default in
  // `RouteServiceProvider::mapApiRoutes()`, but the URI may arrive with
  // or without a leading slash).
  if (u.startsWith("/api/")) u = u.slice(5);
  else if (u.startsWith("api/")) u = u.slice(4);
  u = u.replace(/^\/+/, "");
  if (!u) return "(root)";

  // Apply configurable overrides (order: longest first).
  const sorted = Object.keys(uriGroupOverrides).sort(
    (a, b) => b.length - a.length,
  );
  for (const prefix of sorted) {
    if (u === prefix || u.startsWith(`${prefix}/`)) {
      return uriGroupOverrides[prefix] ?? prefix;
    }
  }

  const segs = u.split("/").filter(Boolean);
  return segs[0] ?? "(root)";
}
/**
 * Human-readable name from a topGroup: capitalized, separators turned
 * into spaces. The `/` separator is preserved as a visual separator
 * (clearer for cases like `tol/tecdoc`); `-` and `_` are replaced by
 * spaces.
 *
 * Examples:
 *   "orders"           → "Orders"
 *   "active-users"     → "Active Users"
 *   "tol/tecdoc"       → "Tol/Tecdoc"
 */
/** `my-orders` → `My Orders`. */
function prettySegment(seg: string): string {
  return seg
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The human-readable name of a folder from its key.
 *
 * `erp-products` becomes `Erp Products`. Only affects what is read in
 * Postman: the key is still the one that groups.
 */
export function prettyGroupName(topGroup: string): string {
  if (!topGroup || topGroup === "(root)") return "Root";
  // If it has '/', process segment by segment to keep the slash as a
  // separator.
  if (topGroup.includes("/")) {
    return topGroup
      .split("/")
      .filter(Boolean)
      .map(prettySegment)
      .join("/");
  }
  return prettySegment(topGroup);
}
