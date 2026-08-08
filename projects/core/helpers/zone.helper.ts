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

/**
 * El orden en que se enseñan las zonas que **tienen contenido**.
 *
 * `zoneOrder` es la preferencia de quien configura el proyecto, no la
 * lista de zonas que existen. Y en zero-config —que es el caso normal,
 * el de los 21 ejemplos— viene **vacía**, con todos los endpoints
 * cayendo en `defaultZone`.
 *
 * `list` y `stats` recorrían `zoneOrder` directamente para imprimir, así
 * que en zero-config no imprimían **nada**: `list` decía "9 endpoints en
 * la colección, agrupados por zona:" y a continuación dejaba la pantalla
 * en blanco. No era un fallo de GraphQL ni de un framework concreto —
 * pasaba en los veintiuno, y el comando entero no servía para nada.
 *
 * Aquí se devuelven las zonas presentes de verdad: primero las que
 * `zoneOrder` nombra, en su orden, y después el resto ordenadas
 * alfabéticamente para que dos ejecuciones den lo mismo. Se omiten las
 * vacías, que es lo que hacía bien el código anterior.
 */
export function zonesToDisplay(
  present: Iterable<string>,
  config: Pick<ProjectConfig, "zoneOrder" | "defaultZone">,
): string[] {
  const conContenido = new Set(present);
  const ordenadas = config.zoneOrder.filter((z) => conContenido.has(z));
  const resto = [...conContenido]
    .filter((z) => !config.zoneOrder.includes(z))
    .sort((a, b) => a.localeCompare(b));
  return [...ordenadas, ...resto];
}
