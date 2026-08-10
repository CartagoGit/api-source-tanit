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

/** Resumen de un proyecto host para inspección rápida. */
export interface IProjectSummary {
  /** Framework detectado. `"unknown"` si no lo reconoció ninguno. */
  framework: string;
  /**
   * Todos los frameworks que reconocieron el proyecto.
   *
   * Más de uno significa proyecto híbrido, y entonces `framework` es
   * solo el de más confianza.
   */
  frameworks: ReadonlyArray<string>;
  /** Nombre del proyecto, del manifiesto de su ecosistema. */
  projectName: string;
  /** BaseUrl efectiva. */
  baseUrl: string;
  /**
   * Endpoints que acabarían en la colección.
   *
   * No es "rutas declaradas en el código": un `apiResource` de Laravel
   * es una línea y siete endpoints, y lo que importa es el segundo
   * número.
   */
  routesInCode: number;
  /** Endpoints cuyas reglas de validación se resolvieron. */
  withFormRequest: number;
  /** Endpoints sin reglas: su body sale de la inferencia agnóstica. */
  withoutFormRequest: number;
  /** Bodies auto-rellenados por la heurística agnóstica. */
  bodiesAdded: number;
  /** Queries auto-rellenadas por la heurística agnóstica. */
  queriesAdded: number;
  /** Modo "zero-config" (no se encontró `config.constant.ts`). */
  zeroConfig: boolean;
  /** Ruta al `config.constant.ts` cargado, o `"<zero-config>"`. */
  configPath: string;
  /** Endpoints definidos manualmente como override. */
  manualEndpoints: number;
  /** Variables de colección derivadas de las rutas. */
  inferredVariables: number;
  /** `null` si el proyecto no expone un endpoint de login. */
  auth: { readonly loginEndpoint: string } | null;
  /** Avisos accionables: proyecto híbrido, nada reconocido… */
  warnings: ReadonlyArray<string>;
}

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
 * en `projects/frameworks/`.
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
  };
}
