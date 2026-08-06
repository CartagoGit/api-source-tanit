/**
 * `DiscoveryOrchestrator` — punto de entrada único del discovery
 * framework-agnostic.
 *
 * Acepta una lista de `IProjectScanner` (cada uno cubre un framework),
 * los evalúa contra el `projectRoot` y los ordena por score.
 * Si hay empate, el orden de la lista manda.
 *
 * `detectAll()` devuelve **todos** los que puntúan, no solo el primero.
 * Importa para los proyectos híbridos: un repo con un Express heredado
 * y rutas nuevas de Next.js casa con dos, y quedarse con uno devolvía 1
 * de 3 endpoints sin decir nada. Los 12 ejemplos puros casan con
 * exactamente un detector, así que mirar el resto no cambia nada para
 * ellos.
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

/** Un framework que ha reconocido el proyecto, con sus colaboradores. */
export interface IDetectedFramework {
  readonly match: IProjectMatch;
  readonly scanner: IRouteScanner | null;
  readonly validation: IValidationSpecProvider | null;
  /** Confianza del detector, de 0 a 1. */
  readonly score: number;
}

export class DiscoveryOrchestrator implements IDiscoveryOrchestrator {
  constructor(private readonly registry: DiscoveryRegistry) {}

  /**
   * Todos los frameworks que reconocen el proyecto, de más a menos
   * seguro. Vacío si no lo reconoce ninguno.
   */
  async detectAll(projectRoot: string): Promise<IDetectedFramework[]> {
    const scored: Array<{ detector: IProjectScanner; score: number }> = [];
    for (const detector of this.registry.detectors) {
      let score: number;
      try {
        score = await detector.detect(projectRoot);
      } catch {
        // Un detector que revienta no puede tumbar a los otros once.
        score = 0;
      }
      if (score > 0) scored.push({ detector, score });
    }
    scored.sort((a, b) => b.score - a.score);

    const detected: IDetectedFramework[] = [];
    for (const { detector, score } of scored) {
      const match = await detector.resolve(projectRoot);
      detected.push({
        match,
        score,
        scanner: this.registry.routeScanners.find((r) => r.matches(match)) ?? null,
        validation:
          this.registry.validationProviders.find((v) => v.framework === match.framework) ??
          null,
      });
    }
    return detected;
  }

  /** El framework más probable. Atajo sobre `detectAll()`. */
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
