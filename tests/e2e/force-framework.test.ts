/**
 * Decirle a la herramienta de qué tipo es la API.
 *
 * La autodetección va por manifiestos, y hay formas de proyecto donde
 * **no puede** acertar:
 *
 *   - Un monorepo donde el `package.json` está en la raíz y la API en
 *     `services/api/`, así que apuntando a la API no hay manifiesto.
 *   - Una dependencia con alias, o un fork con otro nombre de paquete.
 *   - Un manifiesto que se genera en el build y no está en el repo.
 *
 * En todos, quien ejecuta esto **sabe** de qué framework es su API. No
 * poder decírselo convertía un caso resoluble en un callejón sin
 * salida, con un mensaje que sonaba a "no soportado" cuando sí lo está.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";
import { FRAMEWORK_IDS } from "../../packages/contracts/constants/frameworks/framework-ids.constant";

/** Copia del fixture de Fastify SIN su `package.json`. */
let sinManifiesto = "";
let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "force-framework-"));
  sinManifiesto = join(workDir, "api");
  await cp(comprehensiveFixtureDir("fastify"), sinManifiesto, { recursive: true });
  await unlink(join(sinManifiesto, "package.json"));
}, 60_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe("sin manifiesto no hay detección posible", () => {
  test("sin forzar, no reconoce nada y lo dice", async () => {
    const result = await generateWithAllFrameworks(sinManifiesto);
    expect(result.frameworks).toEqual([]);
    expect(result.metrics.specs).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("forzando el framework, encuentra los endpoints", async () => {
    const result = await generateWithAllFrameworks(sinManifiesto, {
      forceFramework: "fastify",
    });
    expect(result.match?.framework).toBe("fastify");
    expect(result.metrics.specs).toBeGreaterThan(5);
  });

  test("forzar también resuelve las reglas de validación", async () => {
    const result = await generateWithAllFrameworks(sinManifiesto, {
      forceFramework: "fastify",
    });
    expect(result.metrics.withValidation).toBeGreaterThan(0);
  });
});

describe("un id que no existe", () => {
  // Falla ANTES de escanear: un id mal escrito descubierto al final,
  // tras recorrer el proyecto y con cero endpoints, no dice nada de lo
  // que ha pasado.
  test("falla al instante", async () => {
    await expect(
      generateWithAllFrameworks(sinManifiesto, { forceFramework: "inventado" }),
    ).rejects.toThrow(/No hay ningún scanner/);
  });

  test("el error lista los frameworks disponibles", async () => {
    await expect(
      generateWithAllFrameworks(sinManifiesto, { forceFramework: "inventado" }),
    ).rejects.toThrow(/fastify/);
  });
});

describe("forzar no cambia nada cuando la detección ya acierta", () => {
  test.each([...FRAMEWORK_IDS])(
    "%s da lo mismo detectado que forzado",
    async (framework) => {
      const root = comprehensiveFixtureDir(framework);
      const detectado = await generateWithAllFrameworks(root);
      const forzado = await generateWithAllFrameworks(root, { forceFramework: framework });
      expect(forzado.metrics.specs).toBe(detectado.metrics.specs);
      expect(forzado.match?.framework).toBe(framework);
    },
  );
});
