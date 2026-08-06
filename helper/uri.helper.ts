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

// ---------------------------------------------------------------------------
// Agrupación de endpoints en carpetas
//
// Vivían en el parser de rutas de Laravel, pero solo miran la URI: el
// primer segmento significativo se convierte en el nombre de carpeta.
// Eso vale igual para Gin o para FastAPI, así que son del núcleo.
// ---------------------------------------------------------------------------

/**
 * Devuelve el grupo top-level lógico de una URI (primer segmento
 * significativo). Por ejemplo:
 *
 *   "api/clientes"             → "clientes"
 *   "api/clientes/{cliente}"   → "clientes"
 *   "api/erp/productos"        → "erp"
 *   "api/pedidos/historial"    → "pedidos"
 *   "alive" / "login"          → "login" / "alive"
 *
 * Si la URI empieza por `api/`, lo salta. Los casos especiales se
 * configuran vía `uriGroupOverrides` (p. ej. `{ "tol/tecdoc": "tol/tecdoc" }`).
 *
 * @param uri URI a analizar.
 * @param uriGroupOverrides Mapa prefijo → clave de grupo (del `ProjectConfig`).
 */
export function topGroupFor(
  uri: string,
  uriGroupOverrides: Record<string, string> = {},
): string {
  let u = uri;
  // Quito `/api/` o `api/` del inicio (Laravel añade `api/` por defecto
  // en `RouteServiceProvider::mapApiRoutes()`, pero la URI puede llegar
  // con o sin slash inicial).
  if (u.startsWith("/api/")) u = u.slice(5);
  else if (u.startsWith("api/")) u = u.slice(4);
  u = u.replace(/^\/+/, "");
  if (!u) return "(raíz)";

  // Aplicar overrides configurables (orden: más largos primero).
  const sorted = Object.keys(uriGroupOverrides).sort(
    (a, b) => b.length - a.length,
  );
  for (const prefix of sorted) {
    if (u === prefix || u.startsWith(`${prefix}/`)) {
      return uriGroupOverrides[prefix] ?? prefix;
    }
  }

  const segs = u.split("/").filter(Boolean);
  return segs[0] ?? "(raíz)";
}
/**
 * Nombre legible a partir del topGroup: capitalizado, separadores con
 * espacio. El separador `/` se conserva como separador visual (más
 * claro para casos como `tol/tecdoc`); `-` y `_` se sustituyen por
 * espacio.
 *
 * Ejemplos:
 *   "pedidos"           → "Pedidos"
 *   "usuarios-activos"  → "Usuarios Activos"
 *   "tol/tecdoc"        → "Tol/Tecdoc"
 */
/** `mis-pedidos` → `Mis Pedidos`. */
function prettySegment(seg: string): string {
  return seg
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function prettyGroupName(topGroup: string): string {
  if (!topGroup || topGroup === "(raíz)") return "Raíz";
  // Si tiene '/', lo procesamos segmento a segmento para preservar la
  // barra como separador.
  if (topGroup.includes("/")) {
    return topGroup
      .split("/")
      .filter(Boolean)
      .map(prettySegment)
      .join("/");
  }
  return prettySegment(topGroup);
}
