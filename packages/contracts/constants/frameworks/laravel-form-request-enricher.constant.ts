/**
 * Instancia por defecto del enricher para `provider: "laravel-form-request"`.
 *
 * Phase 1 (S5 / a00012): el enricher es **idempotente** — devuelve el
 * `EndpointSpec` tal cual. La generación real de variantes de body y
 * query sigue viviendo en `enrichCatalogWithFormRequests`, una función
 * legacy de `packages/frameworks/laravel/catalog-enricher.service.ts`
 * que opera sobre la colección Postman completa y no sobre specs
 * individuales.
 *
 * Mover esa lógica al enricher es follow-up explícito: el contrato
 * per-spec se completa cuando `IEndpointSpec` pueda llevar sus
 * variantes (siguiente fase del plan de estabilización). Hasta entonces,
 * registrar este enricher cumple dos cosas:
 *
 *   1. Hace que `runValidationEnrichers` no devuelva `undefined` para
 *      specs de Laravel (el provider está cubierto).
 *   2. Permite que `generate` añada el side-effect import
 *      (`registerValidationEnricher(LARAVEL_FORM_REQUEST_ENRICHER)`)
 *      sin que `core` tenga que saber de Laravel.
 *
 * El enricher vive aquí (en `contracts/constants/`) y NO al lado del
 * registry para que el invariante `lint:contracts` siga verde:
 * declarar el contrato y su instancia por defecto donde sólo hay
 * datos significa que `frameworks/laravel/catalog-enricher.service.ts`
 * puede importar `LARAVEL_FORM_REQUEST_ENRICHER` sin arrastrar el
 * registry a quien sólo quiere el nombre.
 */
import type { EndpointSpec } from "../../interfaces/core/postman.interface.js";
import type { IValidationEnricher } from "../../interfaces/core/validation-enricher.interface.js";

export const LARAVEL_FORM_REQUEST_ENRICHER: IValidationEnricher = {
  provider: "laravel-form-request",
  enrich: (spec: EndpointSpec): EndpointSpec => spec,
};
