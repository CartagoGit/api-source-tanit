/**
 * Capa de frameworks — todo lo que sabe de un framework concreto.
 *
 * El reparto del repo es este:
 *
 *   `contracts/`, `helpers/`, `services/`  →  núcleo agnóstico. Vale igual
 *       para una API de Laravel que para una de Gin. No conoce ni un
 *       solo framework por su nombre.
 *   `frameworks/`                       →  lo concreto. Los 12 scanners,
 *       los parsers de cada librería de validación, y el registro que
 *       los cataloga.
 *   `scripts/`                          →  la raíz de composición. Es
 *       quien une las dos capas.
 *
 * La flecha va en un solo sentido: `frameworks/` importa del núcleo, y
 * el núcleo **nunca** importa de aquí. Antes no era así —
 * `generation.pipeline.ts` importaba `defaultOrchestrator()` del
 * registro, y con él entraban los 12 scanners— y el resultado es que el
 * núcleo no se podía compilar, ni testear, ni razonar sin arrastrar
 * Laravel, Spring Boot y Gin detrás. Un núcleo agnóstico con una arista
 * hacia lo concreto es agnóstico solo en la documentación.
 *
 * Este fichero es la puerta: quien quiera "el producto entero" importa
 * de aquí y se lleva el catálogo completo cableado.
 */
import { generateCollection } from "../core/discovery/generation.pipeline.js";
import { summarizeProject } from "../core/discovery/summary.service.js";
import { laravelLegacyDiscovery } from "./laravel/legacy-discovery.js";
import { defaultOrchestrator } from "./framework.registry.js";
import { ensureResponseInferrersRegistered } from "./scanners/response-inferrers.js";

// f00012 wiring: this barrel is the composition point where the
// framework response inferrers register themselves. Importing it here
// (side effect) is what turns the previously dead inference registry
// into a populated one for every entry point that goes through
// `frameworks/` (CLI, MCP plugin, UI, tests). `core` cannot import
// this (`lint:boundaries`), which is exactly why the barrel lives on
// this side of the line.
ensureResponseInferrersRegistered();

export { laravelLegacyDiscovery } from "./laravel/legacy-discovery.js";

export {
  DEFAULT_REGISTRY,
  defaultOrchestrator,
  registeredFrameworkIds,
  scannerBundleFor,
} from "./framework.registry.js";

// a00015 S1: `tagged-template.ts` expone la vista AST de los
// `TaggedTemplateExpression` que el frontend TS ya parsea pero no
// expone. Re-export aquí para que los adapters del paquete
// `frameworks` (hoy el scanner GraphQL en S2) importen del barrel
// de su capa en vez de conocer la ruta interna al módulo.
export {
  collectTaggedTemplates,
  collectTaggedTemplatesFromSource,
  type ITaggedTemplate,
} from "./typescript/tagged-template.helper.js";
import type { IGenerationResult } from "../contracts/interfaces/core/discovery.interface.js";
import type { IProjectSummary } from "../contracts/interfaces/core/domain.interface.js";
import type { IGenerateOptions } from "../contracts/interfaces/frameworks/scanners.interface.js";

/**
 * Genera la colección con **todos** los frameworks soportados.
 *
 * Es el atajo para el 99% de los casos: el CLI, el plugin y el gate no
 * quieren elegir catálogo, quieren el completo. Quien sí necesite un
 * subconjunto (un test que solo debe ver un framework, un consumidor
 * que embebe la librería) llama a `generateCollection()` directamente y
 * le pasa el suyo.
 *
 * Multi-service contract (audit 2026-09-06 second pass §3.3):
 *   - one service                       → `IGenerationResult` of that service
 *   - N services + `combineServices:false` → throws
 *     `MultipleServicesWithoutCombineError` (x00024). Callers that
 *     want the array use `generateCollectionsWithAllFrameworks`.
 *   - N services + `combineServices:true`  → one combined `IGenerationResult`.
 */
export function generateWithAllFrameworks(
  projectRoot: string,
  options: IGenerateOptions = {},
): Promise<IGenerationResult> {
  return generateCollection(projectRoot, {
    ...options,
    orchestrator: defaultOrchestrator(),
    // Compatibilidad: los proyectos que usaban esto antes de que
    // existieran los scanners dependen de la heurística de Laravel
    // cuando su disposición no encaja con el scanner.
    legacyFallback: laravelLegacyDiscovery,
  }) as Promise<IGenerationResult>;
}

/**
 * Plural facade: ALWAYS returns a `ReadonlyArray<IGenerationResult>`,
 * one entry per detected service. The single-service path returns a
 * one-element array.
 *
 * Use this facade in CLI commands that must not silently drop the
 * other services when `combineServices` is false (audit 2026-09-06
 * §3.3 / §18 priority 7). The singular facade
 * `generateWithAllFrameworks` is kept for callers that only handle
 * the combined case.
 */
export async function generateCollectionsWithAllFrameworks(
  projectRoot: string,
  options: IGenerateOptions = {},
): Promise<ReadonlyArray<IGenerationResult>> {
  const result = await generateCollection(projectRoot, {
    ...options,
    orchestrator: defaultOrchestrator(),
    legacyFallback: laravelLegacyDiscovery,
  });
  return Array.isArray(result) ? result.slice() : [result];
}

/**
 * Inspecciona un proyecto con todos los frameworks soportados.
 *
 * El equivalente de `generateWithAllFrameworks()` para el camino de
 * solo lectura: `summary`, el modo `--inspect` y el tool del plugin.
 */
export function summarizeWithAllFrameworks(
  projectRoot: string,
): Promise<IProjectSummary> {
  return summarizeProject(projectRoot, defaultOrchestrator(), laravelLegacyDiscovery);
}
