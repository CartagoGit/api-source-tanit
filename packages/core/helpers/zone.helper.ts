/**
 * Logical-zone helpers.
 *
 * Zones are defined in `ProjectConfig.zones` and used in `list` /
 * `stats` to group endpoints by functional area.
 */
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";

/**
 * Computes the logical zone from the endpoint URI and the project
 * configuration.
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
 * The order in which zones that **have content** are shown.
 *
 * `zoneOrder` is the preference of whoever configures the project, not
 * the list of zones that exist. And in zero-config — the normal case,
 * the 21 examples — it comes **empty**, with all endpoints falling into
 * `defaultZone`.
 *
 * `list` and `stats` used to walk `zoneOrder` directly to print, so in
 * zero-config they printed **nothing**: `list` said "9 endpoints in the
 * collection, grouped by zone:" and then left the screen blank. It was
 * not a GraphQL failure or a specific framework's — it happened in all
 * twenty-one, and the entire command served no purpose.
 *
 * Here we return the zones actually present: first those that
 * `zoneOrder` names, in their order, then the rest sorted
 * alphabetically so two runs produce the same. Empty zones are omitted,
 * which is what the previous code did right.
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
