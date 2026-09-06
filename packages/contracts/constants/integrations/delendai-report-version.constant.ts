/**
 * Versión del contrato de reporte JSON que el plugin MCP de Delendai
 * (`integrations/delendai/`) sabe leer.
 *
 # Este contrato es compartido entre el **producto** (CLI genera el
 # reporte) y la **integración** (plugin lee el reporte). Por tanto
 # pertenece a `packages/contracts/`: la regla `lint:contracts` lo
 # exige así y la razón es real — si un consumidor (test, plugin,
 # herramienta externa) quiere tipar la versión que espera leer,
 # tiene que poder hacerlo sin importar el producto.
 #
 # El número se mantiene en lockstep con `GENERATE_REPORT_VERSION`
 # en `packages/contracts/interfaces/core/generate-report.interface.ts`.
 # Un test en `tests/cli/generate-json-report.test.ts` comprueba que
 # los dos coinciden: si alguien bumpea uno sin el otro, la
 # integración se rompe en silencio.
 #
 # x00041: este constant vivía en el plugin (que era workspace), y
 # por eso el test del producto podía importarlo directamente. Al
 # sacar el plugin de `workspaces` el test se quedó sin acceso; la
 # solución correcta es moverlo a `contracts/`, que es lo que la
 # regla `lint:contracts` llevaba pidiendo desde siempre.
 */
export const SUPPORTED_REPORT_VERSION = 3;
