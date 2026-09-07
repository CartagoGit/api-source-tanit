/**
 * `DiscoveryOrchestrator` — the single entry point for framework-agnostic
 * discovery.
 *
 * Accepts a list of `IProjectScanner` instances (each covering a framework),
 * evaluates them against `projectRoot`, and orders them by score. Ties retain
 * list order.
 *
 * `detectAll()` returns **all** scanners that score, not only the first. This
 * matters for hybrid projects: a repo with legacy Express routes and new
 * Next.js routes matches both, and choosing one silently returned one of three
 * endpoints. Each of the 12 pure examples matches exactly one detector, so
 * checking the others does not change their result.
 *
 * After resolving an `IProjectMatch`, it finds an `IRouteScanner` whose
 * `framework === match.framework` and the corresponding
 * `IValidationSpecProvider`. If no concrete scanner exists, it falls back to
 * `OpenApiRouteScanner` (which covers any API documented with OpenAPI).
 *
 * The MCP plugin's `summary` tool consumes `detectProject()` to avoid
 * generating artifacts when answering "what do you see?".
 */
import type {
  IDetectedFramework,
  IDiscoveryOrchestrator,
  IDiscoveryResult,
  IDetectorDiagnostic,
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpecProvider,
} from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  DiscoveryRegistry,
} from "../../contracts/interfaces/core/discovery.interface.js";
import { runWithConcurrency } from "../helpers/concurrency.helper.js";
import {
  DISCOVERY_CONCURRENCY,
} from "../../contracts/constants/core/runtime-limits.constant.js";

/**
 * Builds a diagnostic for a crashing detector (x00065).
 */
function buildDiagnostic(args: {
  component: string;
  phase: "detect" | "resolve";
  sourceFile: string | null;
  err: unknown;
  durationMs: number;
}): IDetectorDiagnostic {
  const reason =
    args.err instanceof Error
      ? `${args.err.name}: ${args.err.message}`
      : typeof args.err === "string"
        ? args.err
        : "unknown detector error";
  return {
    component: args.component,
    phase: args.phase,
    severity: "error",
    sourceFile: args.sourceFile,
    reason,
    recoverable: true,
    durationMs: args.durationMs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Decides which framework the project uses and which collaborators scan it.
 *
 * Scores every detector in the registry and orders them by confidence. It
 * does not keep only the first: a repo with legacy Express routes and new
 * Next.js routes matches both, and choosing one silently returned one third
 * of the endpoints.
 */
export class DiscoveryOrchestrator implements IDiscoveryOrchestrator {
  constructor(private readonly registry: DiscoveryRegistry) {}

  /**
   * All frameworks that recognize the project, from most to least confident.
   * Empty if none recognizes it.
   */
  /**
   * The requested framework, bypassing scoring.
   *
   * Used by callers that know their API and cannot wait for detection to be
   * correct: a monorepo whose manifest is at the root, an aliased dependency,
   * or a manifest generated at build time.
   *
   * Returns `null` if that id is not registered, so the caller can fail with a
   * useful message instead of scanning in vain.
   *
   * The signature receives a named `{ projectRoot, framework }` object. The
   * former `(projectRoot, framework)` signature and the public contract's
   * `(framework, projectRoot)` signature were incompatible, but both were
   * strings, so TypeScript did not catch them being exchanged. The named object
   * fixes the bug: the key, not the position, determines the role.
   */
  async forceFramework(
    args: { projectRoot: string; framework: string },
  ): Promise<IDetectedFramework | null> {
    const detector = this.registry.detectors.find(
      (d) => d.framework === args.framework,
    );
    if (!detector) return null;

    const match = await detector.resolve(args.projectRoot);
    return {
      match,
      score: 1,
      evidence: [],
      scanner: this.registry.routeScanners.find((r) => r.matches(match)) ?? null,
      validation:
        this.registry.validationProviders.find(
          (v) => v.framework === args.framework,
        ) ?? null,
    };
  }

  /** The ids this registry can scan. */
  supportedFrameworks(): string[] {
    return this.registry.detectors.map((detector) => detector.framework);
  }

  async detectAll(projectRoot: string): Promise<ReadonlyArray<IDetectedFramework>> {
    const { detected } = await this.detectAllWithDiagnostics(projectRoot);
    return detected;
  }

  /**
   * x00065 — same as `detectAll()` but also surfaces detector crashes
   * via `diagnostics`. Today the legacy `detectAll()` swallows them
   * silently (score 0, no record). The diagnostic stream lets a
   * caller — CLI, MCP, UI — distinguish "framework not present"
   * from "detector threw".
   *
   * x00064 — `detect()` and `resolve()` run in parallel with
   * `DISCOVERY_CONCURRENCY` (8). The detectors are independent; the
   * score-sort tie-breaker is preserved by the input-order guarantee
   * of `runWithConcurrency`.
   */
  async detectAllWithDiagnostics(
    projectRoot: string,
  ): Promise<IDiscoveryResult> {
    const diagnostics: IDetectorDiagnostic[] = [];
    // x00064: detect() runs in parallel for all 25 detectors.
    // The factories capture each detector so `runWithConcurrency`
    // keeps the (detector, score, evidence) association intact.
    const detectTasks = this.registry.detectors.map(
      (detector) => async () => {
        const start = Date.now();
        try {
          const result = await detector.detect(projectRoot);
          return {
            detector,
            score: result.score,
            evidence: result.evidence,
            crashed: false as const,
          };
        } catch (error) {
          diagnostics.push(
            buildDiagnostic({
              component: detector.framework,
              phase: "detect",
              sourceFile: projectRoot,
              err: error,
              durationMs: Date.now() - start,
            }),
          );
          return {
            detector,
            score: 0,
            evidence: [] as ReadonlyArray<IDetectedFramework["evidence"][number]>,
            crashed: true as const,
          };
        }
      },
    );
    const detectResults = await runWithConcurrency(
      detectTasks,
      DISCOVERY_CONCURRENCY,
    );
    const scored: Array<{
      detector: IProjectScanner;
      score: number;
      evidence: IDetectedFramework["evidence"];
      originalIndex: number;
    }> = [];
    detectResults.forEach((r, originalIndex) => {
      if (!r.crashed && r.score > 0) {
        scored.push({
          detector: r.detector,
          score: r.score,
          evidence: r.evidence,
          originalIndex,
        });
      }
    });
    // Stable sort: score desc, then input-order tie-breaker so the
    // previous list-order invariant is preserved.
    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.originalIndex - b.originalIndex;
    });

    // x00064: resolve() also parallelised.
    const resolveTasks = scored.map(
      (entry) => async () => {
        const start = Date.now();
        try {
          const match = await entry.detector.resolve(projectRoot);
          return {
            entry,
            match,
            crashed: false as const,
          };
        } catch (error) {
          diagnostics.push(
            buildDiagnostic({
              component: entry.detector.framework,
              phase: "resolve",
              sourceFile: projectRoot,
              err: error,
              durationMs: Date.now() - start,
            }),
          );
          return { entry, match: null, crashed: true as const };
        }
      },
    );
    const resolveResults = await runWithConcurrency(
      resolveTasks,
      DISCOVERY_CONCURRENCY,
    );
    const detectedOut: IDetectedFramework[] = [];
    for (const r of resolveResults) {
      if (r.crashed || !r.match) continue;
      detectedOut.push({
        match: r.match,
        score: r.entry.score,
        evidence: r.entry.evidence,
        scanner:
          this.registry.routeScanners.find((s) => s.matches(r.match!)) ?? null,
        validation:
          this.registry.validationProviders.find(
            (v) => v.framework === r.match!.framework,
          ) ?? null,
      });
    }
    return Object.freeze({
      detected: Object.freeze(detectedOut),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  /** The most likely framework. Shortcut over `detectAll()`. */
  async detectProject(projectRoot: string): Promise<{
    match: IProjectMatch | null;
    scanner: IRouteScanner | null;
    validation: IValidationSpecProvider | null;
  }> {
    const detected = await this.detectAll(projectRoot);
    const winner = detected[0];
    if (!winner) return { match: null, scanner: null, validation: null };
    return {
      match: winner.match,
      scanner: winner.scanner,
      validation: winner.validation,
    };
  }
}
