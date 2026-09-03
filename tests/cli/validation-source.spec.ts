/**
 * a00012 S5 — `generate` contra un proyecto Express.
 *
 * Aserción: el adapter ya NO escribe `validationSource` en endpoints
 * cuyo framework no es Laravel. La invariante a cerrar es:
 *
 *   "un proyecto Express NUNCA entra por `enrichCatalogWithFormRequests`"
 *
 * Eso lo demostramos cargando `example-express`, pidiendo specs al
 * adapter universal, y comprobando que ninguno lleva
 * `validationSource.provider === "laravel-form-request"` —ni siquiera
 * cuando el provider configurado devuelve reglas.
 *
 * Es un test de integración corto: usa la API pública del adapter
 * (`buildSpecsFromScanner`) más un scanner sintético que dice ser
 * express pero expone un provider que SIEMPRE devuelve reglas. Antes
 * de S5 eso terminaba con `formRequest: "express:..."` y un viaje
 * inútil por el enricher Laravel; ahora el adapter descarta el
 * provider porque `laravelFormRequestProvider("express")` devuelve
 * `undefined`.
 */
import { describe, expect, test } from "vitest";

import { buildSpecsFromScanner } from "../../packages/core/adapters/parsed-route-to-spec.adapter";
import type {
  IProjectMatch,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../packages/contracts/interfaces/core/scanner.interface";

/** Un `IProjectMatch` sintético para un proyecto Express. */
const MATCH_EXPRESS: IProjectMatch = {
  framework: "express",
  projectRoot: "/tmp/express",
  artifacts: [],
};

/** Scanner que devuelve la única ruta que nos interesa. */
function expressScanner(route: ParsedRoute): IRouteScanner {
  return {
    framework: "express",
    matches: () => true,
    scan: async () => ({ routes: [route] }),
  };
}

/**
 * Provider "amistoso" que SIEMPRE devuelve reglas para cualquier
 * ruta. Antes de S5 esto causaba que el adapter asignara
 * `formRequest: "express:..."` aunque el framework detectado no
 * fuese Laravel. Después de S5 el adapter descarta este resultado.
 */
const friendlyProvider: IValidationSpecProvider = {
  framework: "express",
  supports: async () => true,
  resolve: async (r) => ({
    endpointKey: `${r.method} ${r.uri}`,
    fields: [
      {
        fieldName: "name",
        location: "body",
        type: "string",
        required: true,
      } satisfies IValidationSpec,
    ],
  }),
};

const route = (overrides: Partial<ParsedRoute>): ParsedRoute => ({
  method: "POST",
  uri: "/users",
  rawUri: "/users",
  sourceFile: "src/routes.ts",
  lineNumber: 1,
  prefixChain: [],
  ...overrides,
});

describe("a00012 S5 — generate contra un proyecto Express", () => {
  test("el adapter NO asigna validationSource a un endpoint Express", async () => {
    const result = await buildSpecsFromScanner(
      expressScanner(route({ method: "POST", uri: "/users" })),
      MATCH_EXPRESS,
      friendlyProvider,
    );
    // El adapter devolvió un spec, lo cual confirma que el provider
    // se ejecutó y devolvió reglas. Eso es lo que ANTES habría
    // activado el enricher Laravel (incorrectamente).
    expect(result.specs).toHaveLength(1);
    const ep = result.specs[0];
    expect(ep).toBeDefined();
    // La invariante S5: `validationSource` queda undefined para
    // frameworks cuyo provider no es Laravel. El campo legacy
    // `formRequest` puede seguir ahí (no es objeto de este slice),
    // pero `validationSource` debe ser `undefined`.
    expect(ep?.validationSource).toBeUndefined();
  });

  test("el adapter SÍ asigna validationSource a un endpoint Laravel", async () => {
    // El caso contrario: un proyecto Laravel con provider friendly.
    // Aquí el adapter DEBE escribir `validationSource.provider ===
    // "laravel-form-request"` y dejar el `enrichCatalogWithFormRequests`
    // hacer su trabajo.
    const MATCH_LARAVEL: IProjectMatch = {
      framework: "laravel",
      projectRoot: "/tmp/laravel",
      artifacts: [],
    };
    const result = await buildSpecsFromScanner(
      expressScanner(route({ method: "POST", uri: "/users" })),
      MATCH_LARAVEL,
      friendlyProvider,
    );
    expect(result.specs).toHaveLength(1);
    const ep = result.specs[0];
    expect(ep?.validationSource?.provider).toBe("laravel-form-request");
    expect(ep?.validationSource?.reference).toContain("laravel");
  });

  test("un endpoint sin provider NO recibe validationSource", async () => {
    // Sin provider, el adapter no debería asignar validationSource
    // (ni formRequest) — son proyectos donde el scanner simplemente
    // no sabe validar. La invariante S5 sigue siendo "sólo Laravel
    // lleva validationSource".
    const result = await buildSpecsFromScanner(
      expressScanner(route({ method: "POST", uri: "/users" })),
      MATCH_EXPRESS,
      null,
    );
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.validationSource).toBeUndefined();
    expect(result.specs[0]?.formRequest).toBeUndefined();
  });
});
