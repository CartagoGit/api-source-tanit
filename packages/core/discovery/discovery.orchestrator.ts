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
   */
  async detectAllWithDiagnostics(
    projectRoot: string,
  ): Promise<IDiscoveryResult> {
    const diagnostics: IDetectorDiagnostic[] = [];
    const scored: Array<{ detector: IProjectScanner; score: number; evidence: IDetectedFramework["evidence"] }> = [];
    for (const detector of this.registry.detectors) {
      const start = Date.now();
      let result: { score: number; evidence: ReadonlyArray<IDetectedFramework["evidence"][number]> };
      try {
        result = await detector.detect(projectRoot);
      } catch (error) {
        // A crashing detector must not take down the other twenty-four.
        // x00065: surface the crash via `diagnostics` so callers can tell
        // "the framework is not present" from "the detector threw".
        diagnostics.push(
          buildDiagnostic({
            component: detector.framework,
            phase: "detect",
            sourceFile: projectRoot,
            err: error,
            durationMs: Date.now() - start,
          }),
        );
        result = { score: 0, evidence: [] };
      }
      if (result.score > 0) {
        scored.push({ detector, score: result.score, evidence: result.evidence });
      }
    }
    scored.sort((a, b) => b.score - a.score);

    const detectedOut: IDetectedFramework[] = [];
    for (const { detector, score, evidence } of scored) {
      // x00065: `resolve()` can also crash; surface it on `diagnostics`.
      const start = Date.now();
      let match;
      try {
        match = await detector.resolve(projectRoot);
      } catch (error) {
        diagnostics.push(
          buildDiagnostic({
            component: detector.framework,
            phase: "resolve",
            sourceFile: projectRoot,
            err: error,
            durationMs: Date.now() - start,
          }),
        );
        continue;
      }
      detectedOut.push({
        match,
        score,
        evidence,
        scanner: this.registry.routeScanners.find((r) => r.matches(match)) ?? null,
        validation:
          this.registry.validationProviders.find((v) => v.framework === match.framework) ??
          null,
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
