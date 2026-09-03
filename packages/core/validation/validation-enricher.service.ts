/**
 * Registry de enriquecedores de validación agnósticos.
 *
 * Sustituye la llamada global a `enrichCatalogWithFormRequests` (Laravel
 * only) por un dispatcher por `ValidationProvider`. La migración a
 * S5 (a00012) tiene dos reglas:
 *
 *   1. El adapter sólo escribe `spec.validationSource.provider` cuando
 *      el provider es uno registrado. Hoy eso es exclusivamente
 *      `"laravel-form-request"`; mañana también `"zod"`, `"joi"`, ...
 *   2. Cada provider tiene UN enricher. Se registra en el bootstrap
 *      de `generate` (side-effect import) y queda disponible para
 *      `runValidationEnrichers`.
 *
 * El enricher opera por **spec**, no por colección. La razón es
 * estructural: la colección Postman mezcla carpetas, requests, scripts
 * y descripciones, y mover todo eso al nivel de un EndpointSpec
 * obligaría a un campo `bodyVariants: PostmanItem[]` que nadie pidió.
 * En Phase 1 los enrichers son idempotentes —devuelven el spec igual—
 * y la generación real de variantes sigue viviendo en
 * `enrichCatalogWithFormRequests`, que ahora es un wrapper que
 * despacha por provider. Mover la lógica completa al enricher es
 * follow-up explícito.
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { ValidationProvider } from "../../contracts/constants/core/validation-provider.constant.js";
import type { IValidationEnricher } from "../../contracts/interfaces/core/validation-enricher.interface.js";

/**
 * Contrato de un enricher.
 *
 * `provider` es el discriminador del registry; `enrich` toma un spec y
 * devuelve un spec. Inmutable: el enricher no muta el input, devuelve
 * uno nuevo si necesita cambios. Esa es la condición para que el
 * registry pueda componerse y para que un fallo en un enricher no
 * contamine al siguiente.
 *
 * La declaración vive en `packages/contracts/interfaces/core/validation-enricher.interface.ts`
 * para cumplir el invariante `lint:contracts`: el tipo debe ser legible
 * sin importar este módulo (que arrastra el Map runtime).
 */
// Re-export para no romper a quien importaba `IValidationEnricher`
// desde aquí. Los imports nuevos deberían ir a contracts/.
export type { IValidationEnricher };

const registry = new Map<ValidationProvider, IValidationEnricher>();

/**
 * Registra (o reemplaza) un enricher para su provider.
 *
 * Idempotente: registrar dos veces el mismo provider deja al segundo
 * como activo. El contrato dice "un enricher por provider", así que
 * los dobles registros son un error de programación — pero el registry
 * no se queja porque un test que registra un stub y luego el real
 * (o al revés) sigue siendo útil mientras los dos se comporten igual.
 */
export function registerValidationEnricher(e: IValidationEnricher): void {
  registry.set(e.provider, e);
}

/** Devuelve el enricher registrado, o `undefined` si no hay. */
export function getValidationEnricher(
  p: ValidationProvider,
): IValidationEnricher | undefined {
  return registry.get(p);
}

/**
 * Ejecuta el enricher registrado para el `provider` del spec.
 *
 *   - Sin `validationSource` → no hay nada que enriquecer; devuelve el spec igual.
 *   - Con `validationSource` pero sin enricher registrado → no es un
 *     error: significa que ese framework aún no migró. El spec vuelve igual.
 *   - Con enricher registrado → devuelve `enricher.enrich(spec)`.
 *
 * La función es pura y síncrona. Phase 1 sólo necesita esto; mover el
 * I/O a los enrichers será follow-up de la siguiente fase (cada
 * provider ya carga sus reglas cuando construye el spec, en el adapter).
 */
export function runValidationEnrichers(spec: EndpointSpec): EndpointSpec {
  const vs = spec.validationSource;
  if (!vs) return spec;
  const e = registry.get(vs.provider);
  if (!e) return spec;
  return e.enrich(spec);
}

/** Sólo para tests: vacía el registry. No usar en código de producto. */
export function _resetValidationEnrichersForTests(): void {
  registry.clear();
}
