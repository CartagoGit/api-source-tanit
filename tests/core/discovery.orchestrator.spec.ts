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
  test("picks the detector with the highest confidence", async () => {
    const result = await orchestratorOf([
      detector("low", 0.3),
      detector("high", 0.9),
      detector("mid", 0.5),
    ]).detectProject("/proyecto");

    expect(result.match?.framework).toBe("high");
  });

  test("ties are broken by registry order", async () => {
    const result = await orchestratorOf([
      detector("first", 1),
      detector("second", 1),
    ]).detectProject("/proyecto");

    expect(result.match?.framework).toBe("first");
  });

  test("a score of 0 disqualifies the detector", async () => {
    const result = await orchestratorOf([
      detector("discarded", 0),
      detector("chosen", 0.1),
    ]).detectProject("/proyecto");

    expect(result.match?.framework).toBe("chosen");
  });

  test("with no detector scoring returns null for everything", async () => {
    const result = await orchestratorOf([detector("nothing", 0)]).detectProject("/proyecto");

    expect(result.match).toBeNull();
    expect(result.scanner).toBeNull();
    expect(result.validation).toBeNull();
  });

  test("an empty registry does not throw", async () => {
    expect((await orchestratorOf([]).detectProject("/proyecto")).match).toBeNull();
  });

  // A scanner that crashes while inspecting a weird project must not
  // stop the others from trying.
  test("a detector that throws counts as score 0", async () => {
    const result = await orchestratorOf([
      detector("broken", 1, { throws: true }),
      detector("healthy", 0.4),
    ]).detectProject("/proyecto");

    expect(result.match?.framework).toBe("healthy");
  });

  test("matches the route scanner of the winning framework", async () => {
    const result = await orchestratorOf(
      [detector("express", 1)],
      [routeScanner("django"), routeScanner("express")],
    ).detectProject("/proyecto");

    expect(result.scanner?.framework).toBe("express");
  });

  test("matches the validation provider of the winning framework", async () => {
    const result = await orchestratorOf(
      [detector("express", 1)],
      [routeScanner("express")],
      [validationProvider("django"), validationProvider("express")],
    ).detectProject("/proyecto");

    expect(result.validation?.framework).toBe("express");
  });

  test("without a registered route scanner returns null for scanner", async () => {
    const result = await orchestratorOf([detector("weird", 1)], []).detectProject("/p");
    expect(result.match?.framework).toBe("weird");
    expect(result.scanner).toBeNull();
  });

  test("without a registered validation provider returns null for validation", async () => {
    const result = await orchestratorOf(
      [detector("weird", 1)],
      [routeScanner("weird")],
      [],
    ).detectProject("/p");
    expect(result.validation).toBeNull();
  });

  test("the match carries the requested projectRoot", async () => {
    const result = await orchestratorOf([detector("x", 1)]).detectProject("/otra/ruta");
    expect(result.match?.projectRoot).toBe("/otra/ruta");
  });

  test("the match preserves the detector's artifacts", async () => {
    const result = await orchestratorOf([detector("x", 1)]).detectProject("/p");
    expect(result.match?.artifacts).toEqual(["x.json"]);
  });
});

describe("DiscoveryOrchestrator.forceFramework", () => {
  test("with a known framework returns IDetectedFramework", async () => {
    const result = await orchestratorOf([detector("express", 1)]).forceFramework({
      projectRoot: "/proyecto",
      framework: "express",
    });
    expect(result).not.toBeNull();
    expect(result?.match.framework).toBe("express");
    expect(result?.match.projectRoot).toBe("/proyecto");
    // Forcing a framework equals score 1 with no detection evidence:
    // the caller KNOWS which one it is, so there are no signals to
    // show.
    expect(result?.score).toBe(1);
    expect(result?.evidence).toEqual([]);
  });

  test("with an unregistered framework returns null", async () => {
    const result = await orchestratorOf([detector("express", 1)]).forceFramework({
      projectRoot: "/proyecto",
      framework: "no-existe",
    });
    expect(result).toBeNull();
  });

  // Closes the historical bug C-2 (a00011):
  //
  //   interface: forceFramework(framework, projectRoot)
  //   impl:      forceFramework(projectRoot, framework)
  //
  // Both were `string` and TypeScript did not flag the swap: an
  // external implementer conforming to the public contract silently
  // received the arguments inverted. The new signature takes a
  // **named object**: the key, not the position, decides the role.
  //
  // To prevent the regression from coming back, this test swaps the
  // VALUES of the input on purpose (an id that looks like a path, a
  // path that looks like an id) and verifies the orchestrator
  // resolves using the correct key.
  test("uses the object's key, not the position: swaps the values on purpose", async () => {
    const result = await orchestratorOf([detector("express", 1)]).forceFramework({
      // Swapped! The one that looks like a framework is a path, and
      // the path looks like an id. If the implementation looked by
      // position (as in the historical bug), it would read "express"
      // as the path and "/var/mi-api" as the framework id, and the
      // "express" detector would try to resolve "/var/mi-api".
      projectRoot: "/var/mi-api",
      framework: "express",
    });
    expect(result).not.toBeNull();
    expect(result?.match.framework).toBe("express");
    expect(result?.match.projectRoot).toBe("/var/mi-api");
  });

  test("matches scanner + validation of the forced framework", async () => {
    const result = await orchestratorOf(
      [detector("express", 1)],
      [routeScanner("express")],
      [validationProvider("express")],
    ).forceFramework({ projectRoot: "/p", framework: "express" });
    expect(result?.scanner?.framework).toBe("express");
    expect(result?.validation?.framework).toBe("express");
  });

  test("without a scanner for the forced framework, scanner stays null", async () => {
    const result = await orchestratorOf(
      [detector("weird", 1)],
      [],
      [validationProvider("weird")],
    ).forceFramework({ projectRoot: "/p", framework: "weird" });
    expect(result?.match.framework).toBe("weird");
    expect(result?.scanner).toBeNull();
    expect(result?.validation?.framework).toBe("weird");
  });

  test("without validation for the forced framework, validation stays null", async () => {
    const result = await orchestratorOf(
      [detector("weird", 1)],
      [routeScanner("weird")],
      [],
    ).forceFramework({ projectRoot: "/p", framework: "weird" });
    expect(result?.scanner?.framework).toBe("weird");
    expect(result?.validation).toBeNull();
  });
});

describe("DiscoveryOrchestrator — isolated detect()/resolve() (audit 2026-09-04 P2 #4 #5)", () => {
  test("a detect() that throws does not bring down other detectors", async () => {
    // Previously this test was not needed: detect() was already
    // protected. It is included explicitly to anchor the contract.
    const result = await orchestratorOf([
      detector("explodes", 0, { throws: true }),
      detector("ok", 0.8),
    ]).detectAll("/proyecto");
    expect(result.map((r) => r.match.framework)).toEqual(["ok"]);
  });

  test("a resolve() that throws is isolated and does not abort discovery", async () => {
    // Previously a defective detector in resolve() brought down the
    // entire discovery. Now that detector falls with score 0 and the
    // others keep going.
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
    // broken-resolve does NOT appear in the output (implicit score 0).
    const names = result.map((r) => r.match.framework);
    expect(names).not.toContain("broken-resolve");
    expect(names).toContain("ok");
  });
});
