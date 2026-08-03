/**
 * Helpers para normalizar URIs antes de comparar.
 *
 * Las URIs tienen cuatro formas que deben coincidir:
 *   - Laravel: `{cliente}` o `{cliente:codigo}`
 *   - Express: `:clientId`
 *   - FastAPI: `{client_id}` (mismo formato que Laravel)
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
    .replace(/:[a-zA-Z_][\w]*/g, ":p") // :id (Express) → :p
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")
    .replace(/^\//, "");
}

/** Quita el prefijo `api/` que añade RouteServiceProvider. */
export function stripApiPrefix(uri: string): string {
  return uri.startsWith("api/") ? uri.slice(4) : uri;
}