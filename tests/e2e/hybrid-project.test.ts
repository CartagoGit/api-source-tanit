/**
 * Proyectos que usan más de un framework a la vez.
 *
 * Es una forma de API real y frecuente —un Express heredado que sigue
 * sirviendo la API vieja mientras las rutas nuevas se escriben en
 * Next.js— y el pipeline la trataba fatal: el orchestrator puntuaba los
 * dos detectores, se quedaba con el de más score y tiraba el otro. El
 * fixture de aquí tiene 6 endpoints y devolvía 3, sin un solo aviso.
 *
 * Que salga incompleto es malo; que salga incompleto **y parezca
 * correcto** es peor: quien lo importa en Postman no tiene forma de
 * saber que le falta media API.
 */
import { describe, expect, test } from "vitest";
import { resolve } from "node:path";

import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import { FIXTURES_DIR } from "../../scripts/helpers/root.helper";

const FIXTURES = FIXTURES_DIR;
const HYBRID = resolve(FIXTURES, "hybrid-express-nextjs");

/** Todas las URIs de la colección, como `MÉTODO /ruta`. */
function endpointsOf(specs: ReadonlyArray<{ method: string; uri: string }>): string[] {
  return specs.map((spec) => `${spec.method} ${spec.uri}`).sort();
}

describe("proyecto híbrido express + nextjs", () => {
  test("reconoce los DOS frameworks, no solo el de más score", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    expect(result.frameworks).toContain("nextjs");
    expect(result.frameworks).toContain("express");
    expect(result.frameworks.length).toBe(2);
  });

  // La regresión: antes esto daba 3 (solo las de Next.js).
  test("encuentra los endpoints de los dos, no los de uno", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    const found = endpointsOf(result.specs);

    // Del Express heredado.
    expect(found.some((e) => e.includes("/api/legacy/users"))).toBe(true);
    // Del Next.js nuevo.
    expect(found.some((e) => e.includes("/api/health"))).toBe(true);
    expect(found.some((e) => e.includes("/api/reports"))).toBe(true);
  });

  test("los 6 endpoints del fixture acaban en la colección", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    // express: GET/POST/DELETE sobre legacy/users · nextjs: health GET,
    // reports GET y POST.
    expect(result.specs.length).toBe(6);
  });

  test("avisa de que el proyecto es híbrido", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    expect(result.warnings.length).toBeGreaterThan(0);
    const combined = result.warnings.join(" ");
    expect(combined).toMatch(/2 frameworks/);
    expect(combined).toMatch(/nextjs/);
    expect(combined).toMatch(/express/);
  });

  test("el aviso dice qué hacer, no solo qué pasa", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    expect(result.warnings.join(" ")).toMatch(/--project-root/);
  });

  test("la colección sigue siendo válida y con un id estable", async () => {
    const first = await generateWithAllFrameworks(HYBRID);
    const second = await generateWithAllFrameworks(HYBRID);
    expect(first.collection.info._postman_id).toBe(second.collection.info._postman_id);
    expect(first.collection.info.schema).toContain("2.1.0");
  });

  test("no repite un endpoint que declaren los dos frameworks", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    const found = endpointsOf(result.specs);
    expect(new Set(found).size).toBe(found.length);
  });
});

describe("proyectos de un solo framework", () => {
  // Escanear todos los candidatos no puede cambiar nada para quien usa
  // un framework y ya: los 12 ejemplos casan con un único detector.
  test.each([
    ["express-comprehensive", "express"],
    ["nextjs-comprehensive", "nextjs"],
    ["laravel-comprehensive", "laravel"],
    ["django-comprehensive", "django"],
  ])("%s sigue detectando solo %s, sin avisos", async (fixture, framework) => {
    const result = await generateWithAllFrameworks(resolve(FIXTURES, fixture));
    expect(result.frameworks).toEqual([framework]);
    expect(result.warnings).toEqual([]);
  });
});
