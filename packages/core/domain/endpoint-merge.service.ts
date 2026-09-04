/**
 * Merge of discovered endpoints with the host's manual overrides.
 *
 * It used to live inside Laravel discovery, but it is not specific to
 * Laravel: it compares `method + uri` while normalizing path parameters and
 * lets the manual spec win field by field. It works the same way regardless
 * of which scanner returns the data, so it belongs in core.
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";

/**
 * Merges auto-discovered specs with an optional manual catalog.
 * The manual spec wins on normalized method+URI (name, body, folder, description).
 *
 * Exported because manual overrides are not a Laravel-specific concern:
 * any project can declare an `endpoints.constant.ts` to correct or extend
 * what the scanner infers.
 */
export function mergeWithManual(
  auto: EndpointSpec[],
  manual: EndpointSpec[],
): EndpointSpec[] {
  if (manual.length === 0) return auto;
  const keyOf = (s: EndpointSpec) =>
    `${s.method} ${s.uri.replace(/\{\{[^}]+\}\}/g, ":p").replace(/\{[^}]+\}/g, ":p")}`;
  const manualMap = new Map(manual.map((s) => [keyOf(s), s]));
  const used = new Set<string>();
  const out: EndpointSpec[] = [];
  for (const a of auto) {
    const k = keyOf(a);
    const m = manualMap.get(k);
    if (m) {
      // The manual spec wins for name/body/folder/description, but it does NOT
      // remove auto-detected formRequest if the override does not include it.
      out.push({
        ...a,
        ...m,
        uri: m.uri || a.uri,
        formRequest: m.formRequest ?? a.formRequest,
        body: m.body ?? a.body,
        folder: m.folder ?? a.folder,
        description: m.description ?? a.description,
      });
      used.add(k);
    } else {
      out.push(a);
    }
  }
  // Manual-only entries (for example, testing endpoints parsed differently)
  for (const m of manual) {
    const k = keyOf(m);
    if (!used.has(k)) out.push(m);
  }
  return out;
}
