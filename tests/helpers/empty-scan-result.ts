/**
 * `EMPTY_SCAN_RESULT` — un `IScanResult` vacío para tests que solo
 * necesitan pasar el contrato del provider.
 *
 * A partir de a00010 S2, `IValidationSpecProvider.supports/resolve`
 * recibe `scanResult` como tercer argumento. Los providers que no
 * derivan reglas de lo que el scanner recogió (los doce que no son
 * Fastify/Hono/Fiber/Rust) lo ignoran, pero el contrato no permite
 * pasar `undefined`. Este módulo da un valor que cumple el shape y
 * mantiene los tests enfocados en lo que están probando.
 *
 * Los tests de Fastify/Hono/Fiber/Rust deben usar el `scanResult`
 * real que devolvió su scanner: ahí sí que miran dentro.
 *
 * `@deprecated` nunca: este helper es deliberado, no temporal.
 */
import type { IScanResult } from "../../packages/contracts/interfaces/core/scanner.interface";

export const EMPTY_SCAN_RESULT: IScanResult = Object.freeze({
  routes: Object.freeze([]) as ReadonlyArray<never>,
});
