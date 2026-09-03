/**
 * Contrato del enricher agnóstico de validación (S5 / a00012).
 *
 * Un `IValidationEnricher` recibe un `IEndpointSpec` y devuelve otro
 * `IEndpointSpec` con las modificaciones que su provider necesite.
 *
 *   - `provider` es el discriminador: el registry
 *     (`packages/core/validation/validation-enricher.service.ts`)
 *     despacha por él, así que dos enrichers con el mismo `provider`
 *     chocan.
 *   - `enrich` es **puro**: no muta el input, devuelve uno nuevo. Eso
 *     permite componer varios enrichers en el futuro sin que un fallo
 *     en uno contamine al siguiente.
 *
 * El contrato es per-spec a propósito: la colección Postman mezcla
 * carpetas, requests, scripts y descripciones, y mover todo eso a un
 * `IEndpointSpec` obligaría a campos como `bodyVariants: PostmanItem[]`
 * que nadie pidió. Phase 1 (S5) deja los enrichers idempotentes; la
 * generación real de variantes sigue en
 * `enrichCatalogWithFormRequests`, que ahora es un wrapper que
 * despacha por provider.
 *
 * El interfaz vive en `contracts/` y no al lado del registry para
 * cumplir el invariante del repo: leer el tipo de un enricher no
 * puede costar importar el registry (que arrastra lógica de runtime).
 */
import type { EndpointSpec } from "./postman.interface.js";
import type { ValidationProvider } from "../../constants/core/validation-provider.constant.js";

export interface IValidationEnricher {
  readonly provider: ValidationProvider;
  enrich(spec: EndpointSpec): EndpointSpec;
}
