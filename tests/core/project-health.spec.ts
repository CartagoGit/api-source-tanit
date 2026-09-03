/**
 * `computeProjectHealth` — la salud de la documentación, en porcentajes.
 *
 * El contrato que se fija aquí es el que consumen el CLI (`summary`
 * en texto), el tool MCP (`summary.health`) y, desde f00010 S3, las
 * tarjetas de la UI. Tres propiedades valen más que diez casos:
 *
 *   · Con cero endpoints, todo `0` — nunca `NaN`, nunca `100` sin rutas.
 *   · Cada porcentaje cuenta **specs finales**: lo que dice es lo que
 *     `generate` escribiría, ni más ni menos.
 *   · El redondeo es a entero, para que el número se muestre tal cual
 *     en los tres sitios.
 */
import { describe, expect, test } from "vitest";

import { computeProjectHealth } from "../../packages/core/domain/project-health.service";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";

/** Helper para construir un EndpointSpec mínimo en tests. */
function spec(partial: Partial<EndpointSpec>): EndpointSpec {
  return {
    name: "Get users",
    method: "GET",
    uri: "/users",
    ...partial,
  };
}

describe("computeProjectHealth", () => {
  test("con 0 rutas, todos los porcentajes son 0", () => {
    expect(computeProjectHealth([])).toEqual({
      withValidationPercent: 0,
      withBodySchemaPercent: 0,
      withExamplesPercent: 0,
      withDescriptionPercent: 0,
    });
  });

  test("con todas las rutas validadas, validación es 100", () => {
    const specs = [
      spec({ formRequest: "laravel:App\\\\Http\\\\Requests\\\\UserRequest" }),
      spec({ formRequest: "laravel:App\\\\Http\\\\Requests\\\\OrderRequest" }),
    ];
    const health = computeProjectHealth(specs);
    expect(health.withValidationPercent).toBe(100);
  });

  test("mezcla: cada categoría se cuenta por su pieza, no por las demás", () => {
    // Cuatro endpoints, cada uno cubre una parte del tablero:
    //   1. validado, con body de reglas, con ejemplos, con descripción.
    //   2. validado, con body de reglas, sin descripción.
    //   3. sin validar, con body inferido y ejemplos.
    //   4. sin validar, sin body, sin descripción.
    const specs = [
      spec({
        method: "POST",
        formRequest: "laravel:App\\\\Http\\\\Requests\\\\UserRequest",
        body: { email: "user@example.com" },
        description: "Crea un usuario.",
      }),
      spec({
        method: "POST",
        formRequest: "laravel:App\\\\Http\\\\Requests\\\\OrderRequest",
        body: { total: 1 },
      }),
      spec({
        method: "POST",
        body: { page: 1 },
        query: [{ key: "page", value: "1" }],
      }),
      spec({ method: "DELETE", uri: "/users/{{id}}" }),
    ];
    const health = computeProjectHealth(specs);

    // Validación: 2 de 4. Body: 3 de 4 (el DELETE no lleva). Ejemplos:
    // 3 de 4 (los mismos tres: todos llevan body con valores).
    // Descripción: 1 de 4.
    expect(health.withValidationPercent).toBe(50);
    expect(health.withBodySchemaPercent).toBe(75);
    expect(health.withExamplesPercent).toBe(75);
    expect(health.withDescriptionPercent).toBe(25);
  });

  test("un body vacío no cuenta como body documentado", () => {
    // `body: {}` es el hueco que dejan las reglas cuyo ejemplo no pudo
    // construirse; contarlo inflaría la nota con un vacío.
    const health = computeProjectHealth([spec({ method: "POST", body: {} })]);
    expect(health.withBodySchemaPercent).toBe(0);
    expect(health.withExamplesPercent).toBe(0);
  });

  test("params con valor cuentan como ejemplos aunque no haya body", () => {
    const health = computeProjectHealth([
      spec({ query: [{ key: "page", value: "1" }] }),
    ]);
    expect(health.withExamplesPercent).toBe(100);
  });

  test("una descripción de solo espacios no cuenta como descripción", () => {
    const health = computeProjectHealth([spec({ description: "   " })]);
    expect(health.withDescriptionPercent).toBe(0);
  });

  test("los porcentajes se redondean a entero", () => {
    // 1 de 3 = 33.33…% → 33. Un número con decimales aquí acabaría
    // partido entre el CLI y el tool.
    const health = computeProjectHealth([
      spec({ formRequest: "laravel:x" }),
      spec({}),
      spec({}),
    ]);
    expect(health.withValidationPercent).toBe(33);
  });
});
