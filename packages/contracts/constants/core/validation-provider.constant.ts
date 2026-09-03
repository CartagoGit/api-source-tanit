/**
 * Catálogo de proveedores de validación agnósticos.
 *
 * Sustituye al antiguo flag implícito que vivía en
 * `EndpointSpec.formRequest`, donde el adapter mezclaba el **nombre del
 * framework** con el **path del artefacto** (`"laravel:app/Http/..."`).
 * El resultado era que cualquier framework podía terminar con un
 * `formRequest` que el enricher de Laravel era el único que entendía —
 * una dependencia cruzada silenciosa.
 *
 * Aquí se listan los proveedores que el orquestador SABE enrutar a un
 * enricher concreto. La regla es:
 *
 *   1. Si un endpoint tiene `validationSource.provider === X`, el
 *      registry DEBE tener un enricher para X.
 *   2. Si no, el endpoint queda **sin enriquecer** (no es un error: es
 *      "este framework no aporta reglas" — lo que S5 quiere preservar).
 *
 * "manual" representa el catálogo declarado a mano en
 * `endpoints.constant.ts`: el usuario pone las reglas, no hay enricher
 * automático. El adapter NUNCA debería asignar este provider — es solo
 * un valor válido para hosts que rellenan `validationSource` a mano.
 *
 * S5 (a00012). El antiguo `formRequest: string` se mantiene en
 * `EndpointSpec` por compat, pero los nuevos proveedores declaran
 * su contrato a través de este catálogo.
 */
export const VALIDATION_PROVIDERS = [
  "zod",
  "joi",
  "json-schema",
  "express-validator",
  "nest-pipes",
  "laravel-form-request",
  "manual",
] as const;

/** ID estable de un proveedor de validación. */
export type ValidationProvider = (typeof VALIDATION_PROVIDERS)[number];
