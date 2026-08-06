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
import {
  generateCollection,
  type IGenerationOptions,
  type IGenerationResult,
} from "../services/generation.pipeline.js";
import {
  summarizeProject,
  type IProjectSummary,
} from "../services/summary.service.js";
import { laravelLegacyDiscovery } from "./laravel/legacy-discovery.js";
import { defaultOrchestrator } from "./registry.js";

export { laravelLegacyDiscovery } from "./laravel/legacy-discovery.js";

export {
  DEFAULT_REGISTRY,
  SUPPORTED_FRAMEWORKS,
  defaultOrchestrator,
  scannerBundleFor,
  type IScannerBundle,
} from "./registry.js";

/** Lo que se puede ajustar sin tocar el catálogo. */
export type IGenerateOptions = Omit<IGenerationOptions, "orchestrator">;

/**
 * Genera la colección con **todos** los frameworks soportados.
 *
 * Es el atajo para el 99% de los casos: el CLI, el plugin y el gate no
 * quieren elegir catálogo, quieren el completo. Quien sí necesite un
 * subconjunto (un test que solo debe ver un framework, un consumidor
 * que embebe la librería) llama a `generateCollection()` directamente y
 * le pasa el suyo.
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
  });
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
