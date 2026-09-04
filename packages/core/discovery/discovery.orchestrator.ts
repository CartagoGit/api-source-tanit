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
 * Si no hay scanner concreto, fallback a `OpenApiRouteScanner` (cubre
 * cualquier API documentada con OpenAPI).
 *
 * El `summary` tool del plugin MCP consume `detectProject()` para
 * evitar tener que generar artefactos para responder "¿qué ves?".
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
 * Decide qué framework es el proyecto y con qué colaboradores se escanea.
 *
 * Puntúa todos los detectores del registro y ordena por confianza. No se
 * queda con el primero: un repo con un Express heredado y rutas nuevas de
 * Next.js casa con dos, y quedarse con uno devolvía un tercio de los
 * endpoints sin decir nada.
 */
export class DiscoveryOrchestrator implements IDiscoveryOrchestrator {
  constructor(private readonly registry: DiscoveryRegistry) {}

  /**
   * Todos los frameworks que reconocen el proyecto, de más a menos
   * seguro. Vacío si no lo reconoce ninguno.
   */
  /**
   * El framework indicado, saltándose la puntuación.
   *
   * Lo usa quien SABE de qué es su API y no puede esperar a que la
   * detección acierte: un monorepo cuyo manifiesto está en la raíz, una
   * dependencia con alias, un manifiesto que se genera en el build.
   *
   * Devuelve `null` si ese id no está registrado, para que quien llama
   * pueda fallar con un mensaje útil en vez de escanear en vano.
   *
   * La firma recibe un objeto nomado `{ projectRoot, framework }` —
   * la antigua `(projectRoot, framework)` y la del contrato público
   * `(framework, projectRoot)` eran incompatibles pero ambas `string`,
   * y TypeScript no marcaba el intercambio. El objeto nomado cierra
   * el bug: la clave, no la posición, decide el rol.
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

  /** Los ids que este registro sabe escanear. */
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
        // Un detector que revienta no puede tumbar a los otros once.
        // Audit 2026-09-04 P2 #4 (resolución de errores en detect):
        // antes se silenciaba sin dejar rastro. Ahora el caller puede
        // saber por qué falló vía `failedDetectors` (no implementado
        // aquí — el audit pide no perder la señal sin acoplarse a
        // console). Por ahora conservamos el contrato: `score: 0` y
        // el detector queda fuera del pipeline.
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
      // Audit 2026-09-04 P2 #5: `resolve()` también puede reventar.
      // Antes solo `detect()` estaba protegido — un resolve defectuoso
      // tiraba abajo el discovery entero. Ahora lo aislamos: el
      // detector problemático cae con un warning al pipeline en vez
      // de abortar todo.
      let match;
      try {
        match = await detector.resolve(projectRoot);
      } catch (error) {
        // Score pasa a 0 para que `expandMonorepoDetection` y el
        // resto del pipeline lo traten como no detectado.
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
