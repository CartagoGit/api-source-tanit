/**
 * Helpers de zonas lógicas.
 *
 * Las zonas se definen en `ProjectConfig.zones` y se usan en
 * `list` / `stats` para agrupar endpoints por área funcional.
 */
import type { ProjectConfig } from "../contracts/project-config.interface.js";

/**
 * Calcula la zona lógica a partir de la URI del endpoint y la
 * configuración del proyecto.
 */
export function zoneForUri(uri: string, config: ProjectConfig): string {
  let u = uri;
  if (u.startsWith("/api/")) u = u.slice(5);
  else if (u.startsWith("api/")) u = u.slice(4);
  u = u.replace(/^\/+/, "");
  if (!u) return config.defaultZone;

  for (const [prefix, zone] of config.zones) {
    if (u === prefix || u.startsWith(`${prefix}/`)) return zone;
  }
  return config.defaultZone;
}
