/**
 * `summary` tiene que anticipar lo que hace `generate`.
 *
 * Ese es su contrato entero: alguien lo llama para decidir si merece la
 * pena generar. Si los números no cuadran, no sirve para decidir nada.
 *
 * Y no cuadraban. `summary` tenía su propio camino de descubrimiento con
 * una lista a mano, `NON_LARAVEL_FRAMEWORKS`, que enumeraba once de los
 * doce frameworks. Laravel no estaba, así que se iba por una heurística
 * distinta y contaba las rutas **declaradas** en vez de los endpoints
 * que acaban en la colección: para `examples/example-laravel` decía 7
 * donde el pipeline encuentra 17.
 *
 * Lo grave no era el 7: era que una lista paralela de frameworks se
 * queda vieja sola. Un framework nuevo tampoco habría estado, y habría
 * caído al camino viejo sin que nada lo dijera.
 */
import { describe, expect, test } from "vitest";

import { generateWithAllFrameworks, summarizeWithAllFrameworks } from "../../projects/frameworks/index";
import {
  PROPOSALS_DIR,
  comprehensiveFixtureDir,
} from "../../scripts/helpers/root.helper";
import { FRAMEWORK_IDS } from "../../projects/contracts/constants/frameworks/framework-ids.constant";

describe("summary y generate ven lo mismo", () => {
  test.each([...FRAMEWORK_IDS])(
    "%s: mismos endpoints, mismo framework, mismas reglas resueltas",
    async (framework) => {
      const root = comprehensiveFixtureDir(framework);
      const [summary, generated] = await Promise.all([
        summarizeWithAllFrameworks(root),
        generateWithAllFrameworks(root),
      ]);

      expect(summary.framework).toBe(generated.match?.framework ?? "unknown");
      expect(summary.routesInCode).toBe(generated.metrics.specs);
      expect(summary.withFormRequest).toBe(generated.metrics.withValidation);
      expect(summary.withoutFormRequest).toBe(generated.metrics.withoutValidation);
      expect(summary.frameworks).toEqual(generated.frameworks);
    },
  );

  // La regresión concreta: Laravel era el único excluido de la lista.
  test("laravel no es un caso aparte", async () => {
    const summary = await summarizeWithAllFrameworks(
      comprehensiveFixtureDir("laravel"),
    );
    expect(summary.framework).toBe("laravel");
    // Muy por encima del 7 que daba contando rutas declaradas: el
    // `apiResource` es una línea y cinco endpoints.
    expect(summary.routesInCode).toBeGreaterThan(10);
  });

  test("informa del login igual que la colección", async () => {
    const root = comprehensiveFixtureDir("laravel");
    const [summary, generated] = await Promise.all([
      summarizeWithAllFrameworks(root),
      generateWithAllFrameworks(root),
    ]);
    expect(summary.auth === null).toBe(generated.authFlow?.login == null);
  });

  // Una carpeta que EXISTE pero que ningún scanner reconoce. Devolver
  // cero endpoints con un aviso es la respuesta honesta; lanzar sería
  // decirle a alguien que su proyecto está roto cuando solo es que no
  // lo sabemos leer.
  test("un proyecto que no reconoce nadie no revienta", async () => {
    const summary = await summarizeWithAllFrameworks(PROPOSALS_DIR);
    expect(summary.routesInCode).toBe(0);
    expect(summary.warnings.length).toBeGreaterThan(0);
  });

  test("un projectRoot inexistente sí lanza", async () => {
    await expect(summarizeWithAllFrameworks("/tmp/__no_existe_zzz__")).rejects.toThrow(
      /no existe/i,
    );
  });
});
