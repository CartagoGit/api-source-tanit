/**
 * Helpers para normalizar URIs antes de comparar.
 *
 * Las URIs tienen cinco formas que deben coincidir:
 *   - Laravel: `{cliente}` o `{cliente:codigo}`
 *   - Express: `:clientId`
 *   - FastAPI: `{client_id}` (mismo formato que Laravel)
 *   - Django:  `<id>`, `<int:id>`, `<str:slug>`, `<uuid:token>`
 *   - Postman: `{{clienteId}}`
 *
 * `normalizeForComparison` reduce cualquier token parametrizado a `:p`
 * (mismo marcador, sin importar el nombre). Esto es suficiente para la
 * gran mayoría de casos. La excepción son endpoints que se diferencian
 * solo por el nombre del parámetro y por una regex `where()` en Laravel
 * (p. ej. `/busqueda/{historico}` vs `/busqueda/{matricula}`); estos
 * se documentan en el catálogo con nombres distintos y el script de
 * generación los reporta como requests separadas aunque normalicen
 * igual.
 */
export function normalizeForComparison(uri: string): string {
  return uri
    .replace(/\{\{[^}]+\}\}/g, ":p") // {{algo}} → :p
    .replace(/\{[^}]+\}/g, ":p") // {algo} o {algo:regex} → :p
    .replace(/<[a-zA-Z_][\w]*:[a-zA-Z_][\w]*>/g, ":p") // <int:id> → :p
    .replace(/<[a-zA-Z_][\w]*>/g, ":p") // <id> → :p
    .replace(/:[a-zA-Z_][\w]*/g, ":p") // :id (Express) → :p
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")
    .replace(/^\//, "");
}

/** Quita el prefijo `api/` que añade RouteServiceProvider. */
export function stripApiPrefix(uri: string): string {
  return uri.startsWith("api/") ? uri.slice(4) : uri;
}
/**
 * Une los segmentos de una ruta (prefijo de clase/grupo + path del
 * método) en una URI normalizada.
 *
 * La barra final se conserva **solo si el último segmento no vacío la
 * declaraba**. Esa distinción importa:
 *
 *   - Django: `path("<int:id>/", …)` la trae a propósito. Con
 *     `APPEND_SLASH = True` (el defecto), llamar sin ella devuelve un
 *     301 y un POST pierde el body en la redirección.
 *   - NestJS, Spring Boot, ASP.NET y Flask: `@Controller("orders")` +
 *     `@Get()` concatenaba `"orders" + "/" + ""` y producía `orders/`.
 *     Ahí la barra es un artefacto, no una decisión.
 */
export function joinRoutePath(...segments: string[]): string {
  // Un `"/"` suelto como primer segmento significa "la ruta es
  // absoluta"; no aporta contenido pero sí decide la barra inicial.
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
