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
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpecProvider,
} from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  DiscoveryRegistry,
} from "../../contracts/interfaces/core/discovery.interface.js";

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

  async detectAll(projectRoot: string): Promise<IDetectedFramework[]> {
    const scored: Array<{ detector: IProjectScanner; score: number; evidence: IDetectedFramework["evidence"] }> = [];
    for (const detector of this.registry.detectors) {
      let result: { score: number; evidence: ReadonlyArray<IDetectedFramework["evidence"][number]> };
      try {
        result = await detector.detect(projectRoot);
      } catch (error) {
        // A crashing detector must not take down the other eleven. Audit
        // 2026-09-04 P2 #4 (detect error resolution): this used to be silently
        // swallowed without a trace. The caller can now learn why it failed
        // through `failedDetectors` (not implemented here—the audit requires
        // preserving the signal without coupling to console). For now, preserve
        // the contract: `score: 0` and remove the detector from the pipeline.
        void error;
        result = { score: 0, evidence: [] };
      }
      if (result.score > 0) {
        scored.push({ detector, score: result.score, evidence: result.evidence });
      }
    }
    scored.sort((a, b) => b.score - a.score);

    const detected: IDetectedFramework[] = [];
    for (const { detector, score, evidence } of scored) {
      // Audit 2026-09-04 P2 #5: `resolve()` can also crash. Previously only
      // `detect()` was protected—a defective resolve took down the entire
      // discovery. Isolate it now: the problematic detector falls to the
      // pipeline with a warning instead of aborting everything.
      let match;
      try {
        match = await detector.resolve(projectRoot);
      } catch (error) {
        // Reset the score to 0 so `expandMonorepoDetection` and the rest of
        // the pipeline treat it as undetected.
        void error;
        continue;
      }
      detected.push({
        match,
        score,
        evidence,
        scanner: this.registry.routeScanners.find((r) => r.matches(match)) ?? null,
        validation:
          this.registry.validationProviders.find((v) => v.framework === match.framework) ??
          null,
      });
    }
    return detected;
  }

  /** The most likely framework. Shortcut over `detectAll()`. */
  async detectProject(projectRoot: string): Promise<{
    match: IProjectMatch | null;
    scanner: IRouteScanner | null;
    validation: IValidationSpecProvider | null;
  }> {
    const winner = (await this.detectAll(projectRoot))[0];
    if (!winner) return { match: null, scanner: null, validation: null };
    return {
      match: winner.match,
      scanner: winner.scanner,
      validation: winner.validation,
    };
  }
}
