/**
 * Overrides manuales opcionales para endpoints del proyecto host.
 *
 * Por defecto, el paquete descubre todos los endpoints desde
 * `routes/*.php` automáticamente. Solo añade aquí los endpoints
 * que necesites personalizar (body de ejemplo, nombre legible,
 * carpeta explícita).
 *
 * Ejemplo:
 * ```ts
 * import type { EndpointSpec } from "../../contract/postman.interface.js";
 *
 * export const ALL_ENDPOINTS: EndpointSpec[] = [
 *   {
 *     name: "Login (manual)",
 *     method: "POST",
 *     uri: "/login",
 *     body: { email: "user@ejemplo.com", password: "secret" },
 *   },
 * ];
 * ```
 */
import type { EndpointSpec } from "../../contract/postman.interface.js";

export const ALL_ENDPOINTS: EndpointSpec[] = [
  // Añade aquí tus overrides personalizados.
];