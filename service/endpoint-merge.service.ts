/**
 * Fusión de los endpoints descubiertos con los overrides manuales del
 * host.
 *
 * Vivía dentro del descubrimiento de Laravel, pero no tiene nada de
 * Laravel: compara `method + uri` normalizando los parámetros de ruta y
 * deja ganar al manual campo a campo. Vale igual para lo que devuelva
 * cualquier scanner, y por eso es del núcleo.
 */
import type { EndpointSpec } from "../contract/postman.interface.js";

/**
 * Fusiona specs auto-descubiertos con un catálogo manual opcional.
 * El manual gana en method+uri normalizado (name, body, folder, description).
 *
 * Exportado porque los overrides manuales no son una cosa de Laravel:
 * cualquier proyecto puede declarar un `endpoints.constant.ts` para
 * corregir o ampliar lo que el scanner deduce.
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
      // El manual gana en name/body/folder/description, pero NO borra
      // formRequest auto-detectado si el override no lo trae.
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
  // Manual-only (p. ej. endpoints de testing no parseados igual)
  for (const m of manual) {
    const k = keyOf(m);
    if (!used.has(k)) out.push(m);
  }
  return out;
}
