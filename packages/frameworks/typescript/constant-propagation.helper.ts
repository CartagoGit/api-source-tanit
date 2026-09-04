/**
 * `propagateConstants` — propagación intraprocedural de constantes.
 *
 * (a00016 S4) Cierra el último gap de los 6 estilos del LanguageIR:
 * `const M = "get"; app[M]("/x", h)`. El colector multi-estilo (S2)
 * reconoce la forma `app[M]` como `receiverKind: "computed"` con
 * `method: ""` y `callee: "app[M]"`. Aquí miramos si `M` está en un
 * `IConstantBinding` y, si lo está, rellenamos `resolvedMethod` con
 * el valor literal.
 *
 * Reglas (a00016 non-goals, auditadas):
 *
 *   - Sólo propagamos **literales directos**: `const M = "get"`.
 *   - **NO** propagamos concatenaciones (`const M = "GET" + suffix`).
 *   - **NO** propagamos template literals (`` const M = `get` ``).
 *   - **NO** propagamos expresiones (`` const M = otherVar ``).
 *
 * El límite es a propósito: una propagación aproximada generaría
 * falsos positivos. Los scanners no necesitan el 100 % de los casos
 * — necesitan saber que cuando ven `app[M]()` y `M` es un literal,
 * el método es seguro.
 *
 * El resultado: para cada `IRouteCallExpression` cuya propiedad es
 * `app[M]` y `M` matchea una `IConstantBinding` con valor literal,
 * se rellena `resolvedMethod = String(value)`. Los scanners miran
 * `method || resolvedMethod` para sacar el método final.
 *
 * Lo que el módulo NO hace:
 *   - No resuelve scopes (closures, funciones anidadas, recursión).
 *   - No resuelve `const M = factory()` — factories siempre quedan
 *     como `unknown` en `IConstantBinding.value` (no se emiten).
 *   - No distingue `const` de `let` o `var`. `let M = "get"` también
 *     propaga si nadie reasigna (heurística, no certificada).
 */

import type {
  IConstantBinding,
  IRouteCallExpression,
} from "../../contracts/interfaces/core/language-ir.interface.js";

/**
 * Resuelve las propiedades computed contra un mapa de constantes
 * literales.
 *
 * Para cada `IRouteCallExpression`:
 *
 *   - Si el `callee` tiene la forma `receiver[X]` (con X identifier)
 *     y existe un `IConstantBinding` con `name: "X"` y un valor
 *     literal (`string | number | boolean`), se rellena
 *     `resolvedMethod = String(value)`.
 *   - Si no, la llamada pasa tal cual (el scanner la descarta).
 *
 * Devuelve un NUEVO array — no muta el input.
 */
export function propagateConstants(
  calls: ReadonlyArray<IRouteCallExpression>,
  bindings: ReadonlyArray<IConstantBinding>,
): IRouteCallExpression[] {
  // Construimos un mapa `name → value` para lookup O(1). Si hay
  // bindings duplicados con el mismo nombre, gana el último (es el
  // comportamiento típico de shadowing en un solo archivo).
  const map = new Map<string, string | number | boolean>();
  for (const binding of bindings) {
    // `IConstantBinding.value` ya viene tipado como
    // `string | number | boolean`, pero el cast defensivo protege
    // contra entradas externas que no honren el contrato.
    const value = binding.value;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      map.set(binding.name, value);
    }
  }

  const out: IRouteCallExpression[] = [];
  for (const call of calls) {
    const resolved = resolveOne(call, map);
    out.push(resolved ?? call);
  }
  return out;
}

/**
 * Intenta resolver una sola llamada.
 *
 * Sólo dos `receiverKind` se benefician:
 *   - `"computed"` — `app["get"]` (literal) o `app[M]` (identifier).
 *   - `"optional"` — `app?.["get"]` o `app?.[M]`.
 *
 * Si la propiedad ya es un `method` conocido (caso identifier no
 * computed), no hay nada que propagar: el caller ya tiene el método.
 */
function resolveOne(
  call: IRouteCallExpression,
  map: ReadonlyMap<string, string | number | boolean>,
): IRouteCallExpression | null {
  // Sólo computed (con literal o identifier) y optional entran aquí.
  // El resto de los `receiverKind` ya tienen `method` resuelto.
  if (call.receiverKind !== "computed" && call.receiverKind !== "optional") {
    return null;
  }

  // Si `method` está relleno, la propiedad ya era un literal y el
  // caller no necesita propagación. Esto pasa cuando S2 reconoció
  // `server["get"]` directamente.
  if (call.method !== "") {
    return null;
  }

  // Para `app[M]`, el `callee` que emite S2 es `"app[M]"`. Buscamos
  // el identifier entre los corchetes.
  const match = /\[\s*([A-Za-z_$][\w$]*)\s*\]$/.exec(call.callee);
  if (!match) {
    // `app["get"]` (string literal directo) — ya cubierto por el
    // early-return de arriba. Si llegamos aquí es que el callee no
    // termina en `[X]`; sin más info no propagamos.
    return null;
  }
  const propName = match[1];
  if (!propName) return null;
  const value = map.get(propName);
  if (value === undefined) return null;

  return {
    ...call,
    resolvedMethod: String(value),
  };
}
