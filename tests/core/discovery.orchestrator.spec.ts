import { describe, expect, test } from "vitest";
import { DiscoveryOrchestrator } from "../../packages/core/discovery/discovery.orchestrator";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpecProvider,
} from "../../packages/contracts/interfaces/core/scanner.interface";

function detector(framework: string, score: number, options: { throws?: boolean } = {}): IProjectScanner {
  return {
    framework,
    detect: async () => {
      if (options.throws) throw new Error("detector roto");
      return score;
    },
    resolve: async (projectRoot): Promise<IProjectMatch> => ({
      framework,
      projectRoot,
      artifacts: [`${framework}.json`],
    }),
  };
}

function routeScanner(framework: string): IRouteScanner {
  return {
    framework,
    matches: (match) => match.framework === framework,
    scan: async () => [],
  };
}

function validationProvider(framework: string): IValidationSpecProvider {
  return {
    framework,
    supports: async () => true,
    resolve: async () => ({ endpointKey: "", fields: [] }),
  };
}

function orchestratorOf(
  detectors: IProjectScanner[],
  routeScanners: IRouteScanner[] = [],
  validationProviders: IValidationSpecProvider[] = [],
): DiscoveryOrchestrator {
  return new DiscoveryOrchestrator({ detectors, routeScanners, validationProviders });
}

describe("DiscoveryOrchestrator", () => {
  test("elige el detector con mayor confianza", async () => {
    const result = await orchestratorOf([
      detector("bajo", 0.3),
      detector("alto", 0.9),
      detector("medio", 0.5),
    ]).detectProject("/proyecto");

    expect(result.match?.framework).toBe("alto");
  });

  test("en empate gana el que va primero en el registry", async () => {
    const result = await orchestratorOf([
      detector("primero", 1),
      detector("segundo", 1),
    ]).detectProject("/proyecto");

    expect(result.match?.framework).toBe("primero");
  });

  test("un score de 0 descarta al detector", async () => {
    const result = await orchestratorOf([
      detector("descartado", 0),
      detector("elegido", 0.1),
    ]).detectProject("/proyecto");

    expect(result.match?.framework).toBe("elegido");
  });

  test("sin ningún detector con score devuelve null en todo", async () => {
    const result = await orchestratorOf([detector("nada", 0)]).detectProject("/proyecto");

    expect(result.match).toBeNull();
    expect(result.scanner).toBeNull();
    expect(result.validation).toBeNull();
  });

  test("un registry vacío no lanza", async () => {
    expect((await orchestratorOf([]).detectProject("/proyecto")).match).toBeNull();
  });

  // Un scanner que peta al inspeccionar un proyecto raro no debe
  // impedir que los demás lo intenten.
  test("un detector que lanza cuenta como score 0", async () => {
    const result = await orchestratorOf([
      detector("roto", 1, { throws: true }),
      detector("sano", 0.4),
    ]).detectProject("/proyecto");

    expect(result.match?.framework).toBe("sano");
  });

  test("empareja el route scanner del framework ganador", async () => {
    const result = await orchestratorOf(
      [detector("express", 1)],
      [routeScanner("django"), routeScanner("express")],
    ).detectProject("/proyecto");

    expect(result.scanner?.framework).toBe("express");
  });

  test("empareja el validation provider del framework ganador", async () => {
    const result = await orchestratorOf(
      [detector("express", 1)],
      [routeScanner("express")],
      [validationProvider("django"), validationProvider("express")],
    ).detectProject("/proyecto");

    expect(result.validation?.framework).toBe("express");
  });

  test("sin route scanner registrado devuelve null en scanner", async () => {
    const result = await orchestratorOf([detector("raro", 1)], []).detectProject("/p");
    expect(result.match?.framework).toBe("raro");
    expect(result.scanner).toBeNull();
  });

  test("sin validation provider registrado devuelve null en validation", async () => {
    const result = await orchestratorOf(
      [detector("raro", 1)],
      [routeScanner("raro")],
      [],
    ).detectProject("/p");
    expect(result.validation).toBeNull();
  });

  test("el match lleva el projectRoot que se pidió", async () => {
    const result = await orchestratorOf([detector("x", 1)]).detectProject("/otra/ruta");
    expect(result.match?.projectRoot).toBe("/otra/ruta");
  });

  test("el match conserva los artefactos del detector", async () => {
    const result = await orchestratorOf([detector("x", 1)]).detectProject("/p");
    expect(result.match?.artifacts).toEqual(["x.json"]);
  });
});
