/**
 * a00012 S5 — `IValidationSource` + registry `runValidationEnrichers`.
 *
 * Tres tests mínimos para fijar el contrato agnóstico:
 *
 *   1. Un spec con `provider: "zod"` (registrable a futuro) NO se ve
 *      afectado por el enricher Laravel: el registry devuelve el mismo
 *      objeto cuando el provider no tiene enricher registrado.
 *   2. Un spec con `provider: "laravel-form-request"` SÍ entra por el
 *      enricher registrado. Phase 1 lo deja idempotente, así que la
 *      aserción es que vuelve intacto, pero **habiendo pasado** por el
 *      enricher (lo demostramos registrando un stub que cambia el
 *      `description` y viendo que el cambio se ve).
 *   3. Un spec sin `validationSource` no se toca: el registry es
 *      no-op para los endpoints que el adapter dejó sin provider.
 *
 * El stub del test 2 es local y se desregistra al final; así no
 * contamina el estado global entre tests.
 */
import { afterEach, describe, expect, test } from "vitest";

import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";
import {
  _resetValidationEnrichersForTests,
  getValidationEnricher,
  registerValidationEnricher,
  runValidationEnrichers,
} from "../../packages/core/validation/validation-enricher.service";
import type { IValidationEnricher } from "../../packages/core/validation/validation-enricher.service";

/** Helper para construir specs mínimos en tests. */
function spec(partial: Partial<EndpointSpec>): EndpointSpec {
  return {
    name: "x",
    method: "POST",
    uri: "/x",
    ...partial,
  };
}

afterEach(() => {
  _resetValidationEnrichersForTests();
});

describe("runValidationEnrichers — contrato agnóstico", () => {
  test("un provider sin enricher registrado NO afecta al spec", () => {
    // No registramos nada: `getValidationEnricher("zod")` devuelve
    // `undefined`. La invariante S5 es que cualquier provider sin
    // enricher (zod, joi, json-schema, …) deja pasar el spec tal
    // cual. Un proyecto Express nunca debe acabar mutado por un
    // enricher equivocado.
    const before = spec({
      validationSource: { provider: "zod", reference: "OrderSchema" },
    });
    const after = runValidationEnrichers(before);
    expect(after).toBe(before); // misma referencia: no se construye copia.
  });

  test("un provider registrado SÍ ejecuta su enricher", () => {
    // Phase 1: `LARAVEL_FORM_REQUEST_ENRICHER` es idempotente. Para
    // demostrar que el registry de verdad despacha, registramos un stub
    // que muta la descripción y comprobamos que el cambio aparece.
    // Que el stub sea local al test es importante: si el registry
    // arrastrara estado entre tests, esto se rompería.
    const stub: IValidationEnricher = {
      provider: "laravel-form-request",
      enrich: (s) => ({
        ...s,
        description: `${s.description ?? ""}\n[enriched-by-stub]`,
      }),
    };
    registerValidationEnricher(stub);

    const before = spec({
      validationSource: {
        provider: "laravel-form-request",
        reference: "app/Http/Requests/StoreUserRequest.php",
      },
    });
    const after = runValidationEnrichers(before);
    expect(after.description).toContain("[enriched-by-stub]");
  });

  test("un spec sin validationSource NO se ve afectado", () => {
    // Sin `validationSource` no hay nada que enrutar: el registry
    // devuelve el mismo spec. Esto es la base de "un proyecto que
    // el adapter no marcó como Laravel queda sin enriquecer".
    const before = spec({});
    const after = runValidationEnrichers(before);
    expect(after).toBe(before);
  });
});

describe("helpers de registro", () => {
  test("getValidationEnricher devuelve undefined si no hay enricher", () => {
    expect(getValidationEnricher("joi")).toBeUndefined();
  });

  test("getValidationEnricher devuelve el enricher registrado", () => {
    const stub: IValidationEnricher = {
      provider: "joi",
      enrich: (s) => s,
    };
    registerValidationEnricher(stub);
    expect(getValidationEnricher("joi")).toBe(stub);
  });
});
