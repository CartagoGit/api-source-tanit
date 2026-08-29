/**
 * Dos análisis a la vez en el mismo proceso.
 *
 * No es un caso de laboratorio: el servidor MCP es un proceso de vida
 * larga y puede recibir dos peticiones solapadas de un agente. Y el
 * pipeline dependía de estado **global** — `withProjectRoot()` guardaba
 * `process.env.POSTMAN_PROJECT_ROOT` y una caché de módulo, los pisaba,
 * ejecutaba y restauraba.
 *
 * Con dos llamadas concurrentes eso se destroza: la segunda pisa el
 * valor mientras la primera sigue viva, y al terminar la primera
 * restaura el estado anterior dejando a la segunda mirando la raíz
 * equivocada.
 *
 * Se cazó comparando `summary` con `generate` sobre el mismo proyecto
 * lanzados con `Promise.all`: 16 y 17 endpoints donde secuencialmente
 * dan 18 los dos. Ninguno de los dos números era correcto.
 */
import { describe, expect, test } from "vitest";

import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";

/** Lo que da analizar un fixture a solas, que es la verdad de referencia. */
async function baseline(framework: string): Promise<number> {
  const result = await generateWithAllFrameworks(comprehensiveFixtureDir(framework));
  return result.metrics.specs;
}

describe("pipeline bajo concurrencia", () => {
  test("dos proyectos DISTINTOS a la vez no se mezclan", async () => {
    const [django, laravel] = [await baseline("django"), await baseline("laravel")];

    const [a, b] = await Promise.all([
      generateWithAllFrameworks(comprehensiveFixtureDir("django")),
      generateWithAllFrameworks(comprehensiveFixtureDir("laravel")),
    ]);

    expect(a.match?.framework).toBe("django");
    expect(b.match?.framework).toBe("laravel");
    expect(a.metrics.specs).toBe(django);
    expect(b.metrics.specs).toBe(laravel);
  });

  test("el mismo proyecto dos veces a la vez da lo mismo", async () => {
    const expected = await baseline("express");
    const results = await Promise.all([
      generateWithAllFrameworks(comprehensiveFixtureDir("express")),
      generateWithAllFrameworks(comprehensiveFixtureDir("express")),
    ]);
    for (const result of results) expect(result.metrics.specs).toBe(expected);
  });

  test("seis a la vez, todos correctos", async () => {
    const frameworks = ["laravel", "django", "express", "fastapi", "nestjs", "gin"];
    const expected = new Map<string, number>();
    for (const framework of frameworks) expected.set(framework, await baseline(framework));

    const results = await Promise.all(
      frameworks.map((framework) =>
        generateWithAllFrameworks(comprehensiveFixtureDir(framework)),
      ),
    );

    results.forEach((result, index) => {
      const framework = frameworks[index]!;
      expect(result.match?.framework, framework).toBe(framework);
      expect(result.metrics.specs, framework).toBe(expected.get(framework));
    });
  });

  // La cola no puede romperse porque una llamada falle: si se encadenara
  // la promesa rechazada, la siguiente heredaría el fallo y el proceso
  // quedaría inservible.
  test("un fallo no envenena las llamadas siguientes", async () => {
    const expected = await baseline("flask");

    await expect(
      generateWithAllFrameworks("/tmp/__no_existe_para_la_cola__"),
    ).rejects.toThrow();

    const after = await generateWithAllFrameworks(comprehensiveFixtureDir("flask"));
    expect(after.metrics.specs).toBe(expected);
  });

  test("la identidad de la colección aguanta la concurrencia", async () => {
    const [a, b] = await Promise.all([
      generateWithAllFrameworks(comprehensiveFixtureDir("symfony")),
      generateWithAllFrameworks(comprehensiveFixtureDir("symfony")),
    ]);
    expect(a.collection.info._postman_id).toBe(b.collection.info._postman_id);
  });
});
