/**
 * El caso que justificaba `__params`, ahora sin él.
 *
 * `OpenApiValidationProvider.supports()` tenía que decir "esta ruta es
 * mía" en un proyecto **híbrido** —Express con un spec OpenAPI al
 * lado—, donde `match.framework` es el del framework dominante y no el
 * de cada ruta. Como `ParsedRoute` no llevaba de dónde venía, el scanner
 * se inventó una propiedad escondida, `__params`, que escribía y leía
 * con `as any` para que el compilador no la viera.
 *
 * Era la cuarta vez que mordía la misma pieza que faltaba: la identidad
 * de una ruta. Con `route.framework` la pregunta se responde sola y el
 * contrato vuelve a describir todo lo que circula por el pipeline.
 */
import { describe, expect, test } from "vitest";

import {
  OpenApiProjectScanner,
  OpenApiScanner,
  OpenApiValidationProvider,
} from "../../projects/frameworks/scanners/openapi.scanner";
import { smokeFixtureDir } from "../../scripts/helpers/root.helper";
import type {
  IProjectMatch,
  ParsedRoute,
} from "../../projects/core/contracts/scanner.interface";

const provider = new OpenApiValidationProvider();

function ruta(framework?: string): ParsedRoute {
  return {
    ...(framework !== undefined ? { framework } : {}),
    method: "GET",
    uri: "/users",
    rawUri: "/users",
    sourceFile: "openapi.yaml#GET/users",
    lineNumber: 0,
    prefixChain: [],
  };
}

function proyecto(framework: string): IProjectMatch {
  return { framework, projectRoot: "/tmp/x", artifacts: [] };
}

describe("de quién es cada ruta en un proyecto híbrido", () => {
  /**
   * EL caso. El proyecto es Express; la ruta viene del scanner de
   * OpenAPI. Sin identidad en la ruta esto no se podía distinguir, y de
   * ahí salió `__params`.
   */
  test("una ruta de OpenAPI en un proyecto Express es suya", async () => {
    await expect(provider.supports(ruta("openapi"), proyecto("express"))).resolves.toBe(
      true,
    );
  });

  test("una ruta de Express en un proyecto Express no lo es", async () => {
    await expect(provider.supports(ruta("express"), proyecto("express"))).resolves.toBe(
      false,
    );
  });

  test("en un proyecto OpenAPI puro sigue diciendo que sí", async () => {
    await expect(provider.supports(ruta(), proyecto("openapi"))).resolves.toBe(true);
  });

  test("una ruta sin framework en un proyecto ajeno no se reclama", async () => {
    await expect(provider.supports(ruta(), proyecto("express"))).resolves.toBe(false);
  });
});

describe("el scanner ya no cuela nada fuera del contrato", () => {
  test("las rutas que emite solo llevan campos del contrato", async () => {
    const match = await new OpenApiProjectScanner().resolve(smokeFixtureDir("openapi"));
    const rutas = await new OpenApiScanner().scan(match);
    expect(rutas.length).toBeGreaterThan(0);

    // `__params` era la propiedad escondida: si vuelve, esto la caza.
    for (const r of rutas) {
      expect(Object.keys(r)).not.toContain("__params");
    }
  });
});
