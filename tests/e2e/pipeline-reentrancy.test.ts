/**
 * Reentrancia del pipeline: dos proyectos en el mismo proceso.
 *
 * `paths.service` resuelve la raíz del proyecto **una vez por proceso** y
 * la cachea. Vale para el CLI, que arranca un proceso por proyecto, pero
 * rompe a cualquier consumidor de vida larga —el servidor MCP, el gate,
 * la propia suite de tests—: el segundo proyecto analizado recibía la
 * configuración y las rutas del primero.
 *
 * Era además la causa de fondo del bug del provider de FormRequests de
 * Laravel, que ignoraba `match.projectRoot` y leía el singleton.
 */
import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { generateCollection } from "../../service/generation.pipeline";

const FIXTURES = resolve(import.meta.dir, "../fixtures");

const EXPRESS = join(FIXTURES, "express-comprehensive");
const DJANGO = join(FIXTURES, "django-comprehensive");
const LARAVEL = join(FIXTURES, "laravel-comprehensive");

describe("pipeline reentrante", () => {
  test("dos proyectos seguidos detectan cada uno su framework", async () => {
    const first = await generateCollection(EXPRESS);
    const second = await generateCollection(DJANGO);

    expect(first.match?.framework).toBe("express");
    expect(second.match?.framework).toBe("django");
  });

  test("el segundo proyecto no hereda las rutas del primero", async () => {
    const first = await generateCollection(EXPRESS);
    const second = await generateCollection(DJANGO);

    expect(second.metrics.routes).not.toBe(first.metrics.routes);
    expect(second.match?.projectRoot).toBe(DJANGO);
  });

  test("volver al primero da el mismo resultado que la primera vez", async () => {
    const before = await generateCollection(EXPRESS);
    await generateCollection(DJANGO);
    const after = await generateCollection(EXPRESS);

    expect(after.metrics.routes).toBe(before.metrics.routes);
    expect(after.collection.info._postman_id).toBe(before.collection.info._postman_id!);
  });

  test("cada colección conserva su propia identidad", async () => {
    const express = await generateCollection(EXPRESS);
    const django = await generateCollection(DJANGO);

    expect(express.collection.info._postman_id).not.toBe(
      django.collection.info._postman_id,
    );
  });

  // El provider de FormRequests de Laravel leía la raíz del singleton en
  // lugar de `match.projectRoot`: sin POSTMAN_PROJECT_ROOT no resolvía ni
  // uno, y tras analizar otro proyecto resolvía los del proyecto anterior.
  test("los FormRequest de Laravel se resuelven tras analizar otro proyecto", async () => {
    await generateCollection(EXPRESS);
    const laravel = await generateCollection(LARAVEL);

    expect(laravel.match?.framework).toBe("laravel");
    expect(laravel.metrics.withValidation).toBeGreaterThan(0);
  });

  test("el orden de análisis no cambia el resultado de Laravel", async () => {
    const alone = await generateCollection(LARAVEL);
    await generateCollection(DJANGO);
    const afterOther = await generateCollection(LARAVEL);

    expect(afterOther.metrics.withValidation).toBe(alone.metrics.withValidation);
    expect(afterOther.metrics.routes).toBe(alone.metrics.routes);
  });

  test("no deja POSTMAN_PROJECT_ROOT tocado al terminar", async () => {
    const before = process.env["POSTMAN_PROJECT_ROOT"];
    await generateCollection(EXPRESS);
    expect(process.env["POSTMAN_PROJECT_ROOT"]).toBe(before);
  });

  test("restaura el entorno aunque el pipeline lance", async () => {
    const before = process.env["POSTMAN_PROJECT_ROOT"];
    await generateCollection(join(FIXTURES, "no-existe")).catch(() => undefined);
    expect(process.env["POSTMAN_PROJECT_ROOT"]).toBe(before);
  });
});
