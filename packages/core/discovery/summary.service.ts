/**
 * `summary` — qué ve la herramienta en un proyecto, sin escribir nada.
 *
 * Lo consumen el comando `summary` del CLI y el tool `summary` del
 * plugin, y su contrato con quien lo llama es: **esto es lo que vas a
 * obtener si ejecutas `generate`**. Un resumen que no anticipe la
 * generación no sirve para decidir nada.
 *
 * Por eso corre exactamente el mismo pipeline que `generate` y se limita
 * a proyectar su resultado. No construye artefactos en disco: la
 * colección se arma en memoria y se tira.
 *
 * Antes tenía **su propio** camino de descubrimiento, con una lista a
 * mano llamada `NON_LARAVEL_FRAMEWORKS` que enumeraba once de los doce
 * frameworks. Laravel no estaba, así que se iba por una heurística
 * distinta y contaba las rutas **declaradas** en vez de las que acaban
 * en la colección: para el ejemplo de Laravel decía 7 donde `generate`
 * produce 18. Y al ser una lista paralela, un framework nuevo tampoco
 * habría entrado — habría caído al camino viejo sin que nada lo dijera.
 */
import { resolve } from "node:path";

import type { DiscoveryOrchestrator } from "./discovery.orchestrator.js";
import type { ILegacyDiscovery } from "../../contracts/interfaces/core/legacy-discovery.interface.js";
import { generateCollection } from "./generation.pipeline.js";
import { computeProjectHealth } from "../domain/project-health.service.js";
import type { IProjectSummary } from "../../contracts/interfaces/core/domain.interface.js";

/**
 * Inspecciona `projectRoot` y devuelve un resumen sin escribir archivos.
 *
 * Lanza si el directorio no existe. Si no reconoce el proyecto,
 * devuelve un resumen con cero endpoints y el aviso correspondiente —
 * que es una respuesta honesta, no un error.
 *
 * El catálogo de frameworks y el fallback se inyectan, igual que en el
 * pipeline: este servicio es del núcleo y no puede conocer los scanners
 * concretos. Para el catálogo completo hay `summarizeWithAllFrameworks()`
 * en `packages/frameworks/`.
 */
export async function summarizeProject(
  projectRoot: string,
  orchestrator: DiscoveryOrchestrator,
  legacyFallback?: ILegacyDiscovery,
): Promise<IProjectSummary> {
  // La comprobación de existencia la hace el pipeline, que es quien
  // tiene que decidirlo: así los dos caminos fallan igual y con el
  // mismo mensaje.
  const result = await generateCollection(resolve(projectRoot), {
    orchestrator,
    ...(legacyFallback ? { legacyFallback } : {}),
  });

  return {
    framework: result.match?.framework ?? "unknown",
    frameworks: result.frameworks,
    projectName: result.config.name,
    baseUrl: result.config.baseUrl,
    routesInCode: result.metrics.specs,
    withFormRequest: result.metrics.withValidation,
    withoutFormRequest: result.metrics.withoutValidation,
    bodiesAdded: result.metrics.bodiesInferred,
    queriesAdded: result.metrics.queriesInferred,
    zeroConfig: result.project.zeroConfig,
    configPath: result.project.configPath,
    manualEndpoints: result.project.manualEndpoints,
    inferredVariables: result.config.variables.length,
    auth: result.authFlow?.login
      ? {
          loginEndpoint: `${result.authFlow.login.request?.method ?? "POST"} ${
            result.authFlow.login.request?.url?.raw ?? result.authFlow.login.name
          }`,
        }
      : null,
    warnings: result.warnings,
    evidence: result.match
      ? (await orchestrator.detectAll(resolve(projectRoot)))
          .find((f) => f.match.framework === result.match!.framework)
          ?.evidence ?? []
      : [],
    // Sobre `result.specs`, no sobre los contadores del adapter: los
    // specs ya llevan dentro la inferencia agnóstica y el merge de
    // overrides, que es justo lo que `generate` escribiría.
    health: computeProjectHealth(result.specs),
  };
}
