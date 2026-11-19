/**
 * x00065 — failedDetectors diagnostics. Broken detectors must not be
 * indistinguishable from "framework not present" (both used to surface
 * as `score: 0`).
 *
 * The new `detectAllWithDiagnostics()` keeps the existing
 * `detectAll()` array shape for backwards compatibility, while
 * exposing detector crashes via `IDiscoveryResult.diagnostics`.
 */
import { describe, expect, test } from "vitest";

import {
  DiscoveryOrchestrator,
} from "../../packages/core/discovery/discovery.orchestrator";
import type {
  IProjectScanner,
} from "../../packages/contracts/interfaces/core/scanner.interface";
import type { DiscoveryRegistry } from "../../packages/contracts/interfaces/core/discovery.interface";

function detector(
  framework: string,
  score: number,
  options: { throws?: boolean } = {},
): IProjectScanner {
  return {
    framework,
    detect: async () => {
      if (options.throws) throw new Error(`detect failed for ${framework}`);
      return { score, evidence: [] };
    },
    resolve: async () => ({
      framework,
      projectRoot: "/p",
      artifacts: [],
    }),
  };
}

function emptyRegistry(detectors: IProjectScanner[]): DiscoveryRegistry {
  return {
    detectors,
    routeScanners: [],
    validationProviders: [],
  };
}

describe("x00065 — failedDetectors diagnostics", () => {
  test("(1) legacy detectAll() returns the array (unchanged shape)", async () => {
    const orch = new DiscoveryOrchestrator(
      emptyRegistry([detector("express", 0.8), detector("django", 0)]),
    );
    const detected = await orch.detectAll("/p");
    expect(detected.length).toBe(1);
    expect(detected[0]?.match.framework).toBe("express");
  });

  test("(2) detectAllWithDiagnostics() surfaces a throwing detector as a diagnostic", async () => {
    const orch = new DiscoveryOrchestrator(
      emptyRegistry([
        detector("django", 0, { throws: true }),
        detector("express", 0.8),
      ]),
    );
    const result = await orch.detectAllWithDiagnostics("/p");
    // Express survives; django produces a diagnostic.
    expect(result.detected.length).toBe(1);
    expect(result.detected[0]?.match.framework).toBe("express");
    expect(result.diagnostics.length).toBe(1);
    const diag = result.diagnostics[0]!;
    expect(diag.component).toBe("django");
    expect(diag.phase).toBe("detect");
    expect(diag.severity).toBe("error");
    expect(diag.recoverable).toBe(true);
    expect(diag.reason).toContain("detect failed for django");
    expect(typeof diag.durationMs).toBe("number");
    expect(diag.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("(3) resolve() crashes also produce diagnostics", async () => {
    const broken: IProjectScanner = {
      framework: "broken-resolve",
      detect: async () => ({ score: 0.7, evidence: [] }),
      resolve: async () => {
        throw new Error("resolve roto");
      },
    };
    const orch = new DiscoveryOrchestrator(
      emptyRegistry([broken, detector("ok", 0.8)]),
    );
    const result = await orch.detectAllWithDiagnostics("/p");
    expect(result.detected.length).toBe(1);
    expect(result.detected[0]?.match.framework).toBe("ok");
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]?.phase).toBe("resolve");
    expect(result.diagnostics[0]?.component).toBe("broken-resolve");
  });

  test("(4) clean run produces zero diagnostics", async () => {
    const orch = new DiscoveryOrchestrator(
      emptyRegistry([
        detector("express", 0.8),
        detector("django", 0.5),
      ]),
    );
    const result = await orch.detectAllWithDiagnostics("/p");
    expect(result.diagnostics).toEqual([]);
    expect(result.detected.length).toBe(2);
  });

  test("(5) a non-Error throw is still captured", async () => {
    const weird: IProjectScanner = {
      framework: "weird",
      detect: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "string error";
      },
      resolve: async () => ({
        framework: "weird",
        projectRoot: "/p",
        artifacts: [],
      }),
    };
    const orch = new DiscoveryOrchestrator(emptyRegistry([weird]));
    const result = await orch.detectAllWithDiagnostics("/p");
    expect(result.diagnostics[0]?.reason).toContain("string error");
  });
});