/**
 * Fuente de las reglas de validación de un endpoint.
 *
 * Reemplaza al campo heredado `EndpointSpec.formRequest: string`, que
 * mezclaba el **proveedor** con el **path del artefacto** sin
 * estructura. Ahora el contrato es:
 *
 *   - `provider`: el catálogo agnóstico (`VALIDATION_PROVIDERS`).
 *     Lo decide el adapter en función del framework detectado.
 *   - `reference`: el identificador concreto del recurso (FQCN,
 *     ruta al fichero, nombre del schema…). Su formato depende
 *     **del proveedor** y no se interpreta fuera de su enricher.
 *
 * El adapter (a00012 S5) sólo asigna este campo cuando el provider
 * resultante es `"laravel-form-request"`: el resto de frameworks o no
 * tienen provider registrado o todavía no han migrado. Esa es la
 * invariante que cierra S5: un proyecto Express nunca lleva
 * `validationSource` aunque su provider devuelva reglas.
 */
import type { ValidationProvider } from "../../constants/core/validation-provider.constant.js";

export interface IValidationSource {
  /** Proveedor agnóstico (`"laravel-form-request"`, `"zod"`, …). */
  readonly provider: ValidationProvider;
  /** Identificador concreto que el enricher del provider sabe resolver. */
  readonly reference: string;
}
