/**
 * Dos proyectos generados **a la vez**, sin cola de por medio.
 *
 * Es la prueba que decide si el pipeline puede soltar
 * `withProjectRoot()`. Mientras los servicios de dentro resolvían sus
 * rutas por el singleton de `paths.service`, dos llamadas concurrentes
 * se destrozaban: la segunda pisaba el estado global mientras la primera
 * seguía viva, y al terminar la primera restauraba el de antes dejando a
 * la segunda mirando la raíz equivocada.
 *
 * Se midió en su día comparando `summary` con `generate` sobre el mismo
 * proyecto lanzados con `Promise.all`: 16 y 17 endpoints donde
 * secuencialmente dan 18 los dos.
 *
 * Aquí se usan **dos proyectos distintos y de frameworks distintos**, que
 * es el caso que un servidor MCP atiende de verdad. Si el contexto no
 * llegara de punta a punta, el cruce saldría en el nombre de la
 * colección, en el número de endpoints, o en dónde se escribe.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { comprehensiveFixtureDir, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { generateCollection } from "../../projects/core/discovery/generation.pipeline";
import { defaultOrchestrator } from "../../projects/frameworks/framework.registry";
import { generateWithAllFrameworks } from "../../projects/frameworks/index";
import { FRAMEWORK_IDS } from "../../projects/contracts/constants/frameworks/framework-ids.constant";

let work = "";
let express = "";
let graphql = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "concurrente-"));
  express = join(work, "express");
  graphql = join(work, "graphql");
  await Promise.all([
    copyExampleClean(exampleDir("express"), express),
    copyExampleClean(exampleDir("graphql"), graphql),
  ]);
}, 180_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/**
 * El pipeline construye en memoria; escribir es cosa del script. Por eso
 * aquí no se le pasa carpeta de salida: no la tiene.
 */
function generar(root: string) {
  return generateCollection(root, { orchestrator: defaultOrchestrator() });
}

describe("dos proyectos a la vez", () => {
  /**
   * EL test. Secuencialmente esto pasa siempre; lo que se comprueba es
   * que también pase **en paralelo**.
   */
  test("cada uno recibe sus propios endpoints", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    // Las cifras son las que dan por separado: 9 y 5.
    expect(a.specs.length, "express").toBe(9);
    expect(b.specs.length, "graphql").toBe(5);
  });

  test("cada uno conserva su propia raíz en el contexto", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    expect(a.context.projectRoot).toBe(express);
    expect(b.context.projectRoot).toBe(graphql);
  });

  /**
   * El nombre sale del manifiesto del proyecto, que es lo que
   * `loadProject()` resolvía por el singleton. Si el contexto no llegara
   * hasta el loader, los dos saldrían llamándose igual.
   */
  test("cada colección lleva el nombre de su proyecto", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    expect(a.collection.info.name).not.toBe(b.collection.info.name);
    expect(a.config.name).not.toBe(b.config.name);
  });

  /** Y el framework detectado tampoco se cruza. */
  test("cada uno detecta su propio framework", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    expect(a.frameworks).toContain("express");
    expect(b.frameworks).toContain("graphql");
  });
});

/**
 * El mismo proyecto, dos veces a la vez, en los veintiún frameworks.
 *
 * Es el caso que destapó el fallo de verdad y el que ningún test cubría.
 * En Django daba **19 rutas en una ejecución y 18 en la otra**: los
 * scanners recorren su fuente con regex `/g` declarados a nivel de
 * módulo, y el `lastIndex` de esos regex lo comparte el proceso entero.
 * El bucle hace `await` dentro, así que la otra ejecución le reseteaba
 * la posición a mitad y volvía a leer rutas ya leídas.
 *
 * La ruta de más se fusionaba luego por método + URI, así que la
 * colección salía bien: lo único que mentía era el contador —y un aviso
 * que decía «declarado por más de un framework» habiendo solo uno—.
 * Por eso nadie lo veía.
 *
 * Comparar una ejecución consigo misma es lo que lo hace detectable: no
 * hay que saber cuál es el número correcto, solo que sea el mismo.
 */
describe("el mismo proyecto, dos veces a la vez", () => {
  test.for([...FRAMEWORK_IDS])(
    "%s: las dos ejecuciones ven exactamente lo mismo",
    { timeout: 240_000 },
    async (framework) => {
      const root = comprehensiveFixtureDir(framework);
      const [a, b] = await Promise.all([
        generateWithAllFrameworks(root),
        generateWithAllFrameworks(root),
      ]);

      expect(a.metrics.routes, "rutas escaneadas").toBe(b.metrics.routes);
      expect(a.metrics.specs, "endpoints").toBe(b.metrics.specs);
      expect(a.metrics.withValidation, "reglas resueltas").toBe(
        b.metrics.withValidation,
      );
      expect(a.frameworks).toEqual(b.frameworks);
      // Un aviso que sale en una ejecución y no en la otra es la señal
      // de que algo se ha contado dos veces.
      expect(a.warnings).toEqual(b.warnings);
    },
  );
});
