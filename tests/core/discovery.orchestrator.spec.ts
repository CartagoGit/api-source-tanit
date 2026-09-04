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
      return { score, evidence: [] };
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
    scan: async () => ({ routes: [] }),
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

describe("DiscoveryOrchestrator.forceFramework", () => {
  test("con un framework conocido devuelve IDetectedFramework", async () => {
    const result = await orchestratorOf([detector("express", 1)]).forceFramework({
      projectRoot: "/proyecto",
      framework: "express",
    });
    expect(result).not.toBeNull();
    expect(result?.match.framework).toBe("express");
    expect(result?.match.projectRoot).toBe("/proyecto");
    // Forzar un framework equivale a score 1 sin evidence de detección:
    // quien llama SABE cuál es, así que no hay señales que mostrar.
    expect(result?.score).toBe(1);
    expect(result?.evidence).toEqual([]);
  });

  test("con un framework no registrado devuelve null", async () => {
    const result = await orchestratorOf([detector("express", 1)]).forceFramework({
      projectRoot: "/proyecto",
      framework: "no-existe",
    });
    expect(result).toBeNull();
  });

  // Cierra el bug histórico de C-2 (a00011):
  //
  //   interface: forceFramework(framework, projectRoot)
  //   impl:      forceFramework(projectRoot, framework)
  //
  // Ambos `string` y TypeScript no marcaba el intercambio: un
  // implementador externo conforme con el contrato público recibía
  // los argumentos invertidos en silencio. La firma nueva recibe un
  // **objeto nomado**: la clave, no la posición, decide el rol.
  //
  // Para que la regresión no vuelva, este test intercambia los VALORES
  // del input a propósito (un id que parece ruta, una ruta que parece
  // id) y verifica que el orchestrator resuelve con la clave correcta.
  test("usa la clave del objeto, no la posición: intercambia los valores a propósito", async () => {
    const result = await orchestratorOf([detector("express", 1)]).forceFramework({
      // ¡Intercambiados! El que parece ser framework es una ruta, y la
      // ruta parece un id. Si la implementación mirase por posición
      // (como el bug histórico), leería "express" como ruta y
      // "/var/mi-api" como id de framework, y el detector de "express"
      // intentaría resolver "/var/mi-api".
      projectRoot: "/var/mi-api",
      framework: "express",
    });
    expect(result).not.toBeNull();
    expect(result?.match.framework).toBe("express");
    expect(result?.match.projectRoot).toBe("/var/mi-api");
  });

  test("empareja scanner + validation del framework forzado", async () => {
    const result = await orchestratorOf(
      [detector("express", 1)],
      [routeScanner("express")],
      [validationProvider("express")],
    ).forceFramework({ projectRoot: "/p", framework: "express" });
    expect(result?.scanner?.framework).toBe("express");
    expect(result?.validation?.framework).toBe("express");
  });

  test("sin scanner para el framework forzado, scanner queda null", async () => {
    const result = await orchestratorOf(
      [detector("raro", 1)],
      [],
      [validationProvider("raro")],
    ).forceFramework({ projectRoot: "/p", framework: "raro" });
    expect(result?.match.framework).toBe("raro");
    expect(result?.scanner).toBeNull();
    expect(result?.validation?.framework).toBe("raro");
  });

  test("sin validation para el framework forzado, validation queda null", async () => {
    const result = await orchestratorOf(
      [detector("raro", 1)],
      [routeScanner("raro")],
      [],
    ).forceFramework({ projectRoot: "/p", framework: "raro" });
    expect(result?.scanner?.framework).toBe("raro");
    expect(result?.validation).toBeNull();
  });
});

describe("DiscoveryOrchestrator — detect()/resolve() aislados (audit 2026-09-04 P2 #4 #5)", () => {
  test("detect() que lanza no tira abajo otros detectores", async () => {
    // Antes este test no era necesario: detect() ya estaba
    // protegido. Se incluye explícito para anclar el contrato.
    const result = await orchestratorOf([
      detector("explota", 0, { throws: true }),
      detector("ok", 0.8),
    ]).detectAll("/proyecto");
    expect(result.map((r) => r.match.framework)).toEqual(["ok"]);
  });

  test("resolve() que lanza se aísla y no aborta el discovery", async () => {
    // Antes un detector defectuoso en resolve() tumaba el discovery
    // entero. Ahora ese detector cae con score 0 y los demás siguen.
    const brokenDetector: IProjectScanner = {
      framework: "broken-resolve",
      detect: async () => ({ score: 0.7, evidence: [] }),
      resolve: async () => {
        throw new Error("resolve roto");
      },
    };
    const result = await orchestratorOf([
      brokenDetector,
      detector("ok", 0.8),
    ]).detectAll("/proyecto");
    // broken-resolve NO aparece en la salida (score 0 implícito).
    const names = result.map((r) => r.match.framework);
    expect(names).not.toContain("broken-resolve");
    expect(names).toContain("ok");
  });
});
