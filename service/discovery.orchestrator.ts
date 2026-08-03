/**
 * `DiscoveryOrchestrator` — punto de entrada único del discovery
 * framework-agnostic.
 *
 * Acepta una lista de `IProjectScanner` (cada uno cubre un framework),
 * los evalúa contra el `projectRoot` y se queda con el de mayor score.
 * Si hay empate, el orden de la lista manda.
 *
 * Una vez resuelto el `IProjectMatch`, busca un `IRouteScanner` cuyo
 * `framework === match.framework` y un `IValidationSpecProvider` igual.
 * Si no hay scanner concreto, fallback a `OpenApiScanner` (cubre
 * cualquier API documentada con OpenAPI).
 *
 * El `summary` tool del plugin MCP consume `detectProject()` para
 * evitar tener que generar artefactos para responder "¿qué ves?".
 */
import type {
  IDiscoveryOrchestrator,
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpecProvider,
} from "../contract/scanner.interface.js";

export interface DiscoveryRegistry {
  readonly detectors: ReadonlyArray<IProjectScanner>;
  readonly routeScanners: ReadonlyArray<IRouteScanner>;
  readonly validationProviders: ReadonlyArray<IValidationSpecProvider>;
}

export class DiscoveryOrchestrator implements IDiscoveryOrchestrator {
  constructor(private readonly registry: DiscoveryRegistry) {}

  async detectProject(projectRoot: string): Promise<{
    match: IProjectMatch | null;
    scanner: IRouteScanner | null;
    validation: IValidationSpecProvider | null;
  }> {
    const scored: Array<{ detector: IProjectScanner; score: number }> = [];
    for (const d of this.registry.detectors) {
      let s: number;
      try {
        s = await d.detect(projectRoot);
      } catch {
        s = 0;
      }
      if (s > 0) scored.push({ detector: d, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];
    if (!winner) return { match: null, scanner: null, validation: null };
    const match = await winner.detector.resolve(projectRoot);
    const scanner =
      this.registry.routeScanners.find((r) => r.matches(match)) ?? null;
    const validation =
      this.registry.validationProviders.find((v) => v.framework === match.framework) ?? null;
    return { match, scanner, validation };
  }
}
