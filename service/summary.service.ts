/**
 * Helper `summary` — inspecciona un proyecto host sin generar artefactos.
 *
 * Reemplaza al "hack" que vivía en `summary.tool.ts` (shells out a
 * `generate --inspect` parseando stdout con regex). Esta versión
 * corre **in-process** vía `discoverEndpoints` + `loadProject`, sin
 * subprocesos y sin parsear strings.
 *
 * Uso:
 *   - `scripts/summary.script.ts` (CLI para humanos).
 *   - `plugins/postman-exporter/src/lib/tools/summary.tool.ts`
 *     (tool MCP, llamada directa vía `summarizeProject()`).
 *
 * SOLID: S = solo lectura; D = el `DiscoveryOrchestrator` se inyecta
 * para que un test pueda mockear el adapter.
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";

import { defaultOrchestrator } from "./scanner-registry";
import { buildSpecsFromScanner } from "./adapters/parsed-route-to-spec.adapter";
import { parseAllRoutes } from "./route-parser.service";
import { loadProject } from "./project-loader.service";
import { resetPathCache } from "./paths.service";
import {
  applyAgnosticInference,
  inferCollectionVariables,
} from "./param-inferrer.service";
import type { EndpointSpec } from "../contract/postman.interface";

/** Resumen de un proyecto host para inspección rápida. */
export interface IProjectSummary {
  /** Framework detectado (laravel, openapi, express, fastapi, etc.). */
  framework: string;
  /** Nombre del proyecto (de ProjectConfig.name, info.title, basename). */
  projectName: string;
  /** BaseUrl efectiva (de ProjectConfig.baseUrl). */
  baseUrl: string;
  /** Total de rutas detectadas en código. */
  routesInCode: number;
  /** Endpoints resueltos con FormRequest / schema. */
  withFormRequest: number;
  /** Endpoints sin FormRequest. */
  withoutFormRequest: number;
  /** Bodies auto-rellenados por la heurística agnóstica. */
  bodiesAdded: number;
  /** Queries auto-rellenadas por la heurística agnóstica. */
  queriesAdded: number;
  /** Modo "zero-config" (no se encontró config.constant.ts). */
  zeroConfig: boolean;
  /** Ruta al config.constant.ts cargado (o "<zero-config>"). */
  configPath: string;
  /** Endpoints definidos manualmente (overrides), 0 si no hay. */
  manualEndpoints: number;
}

const NON_LARAVEL_FRAMEWORKS = new Set([
  "openapi",
  "express",
  "fastapi",
  "symfony",
  "nestjs",
  "django",
  "flask",
  "nextjs",
  "gin",
  "springboot",
  "aspnet",
]);

/**
 * Inspecciona `projectRoot` y devuelve un resumen sin escribir
 * archivos. Lanza si el directorio no existe; devuelve un resumen
 * zero-config si el proyecto no es Laravel o no tiene config.
 */
export async function summarizeProject(
  projectRoot: string,
): Promise<IProjectSummary> {
  const abs = resolve(projectRoot);
  if (!existsSync(abs)) {
    throw new Error(`projectRoot no existe: ${projectRoot}`);
  }

  const envPrev = process.env["POSTMAN_PROJECT_ROOT"];
  process.env["POSTMAN_PROJECT_ROOT"] = abs;
  // `paths.service` cachea `projectRoot()` al primer acceso. Sin
  // `resetPathCache()` la segunda llamada vería la raíz del
  // primer `summarizeProject` y `routesDir()` devolvería el
  // directorio equivocado.
  resetPathCache();
  try {
    return await doSummarize(abs);
  } finally {
    if (envPrev === undefined) {
      delete process.env["POSTMAN_PROJECT_ROOT"];
    } else {
      process.env["POSTMAN_PROJECT_ROOT"] = envPrev;
    }
    resetPathCache();
  }
}

async function doSummarize(absRoot: string): Promise<IProjectSummary> {
  const orch = defaultOrchestrator();
  const { match, scanner, validation } = await orch.detectProject(absRoot);

  // Camino A: framework NO-Laravel → adapter directo.
  if (match && scanner && NON_LARAVEL_FRAMEWORKS.has(match.framework)) {
    const result = await buildSpecsFromScanner(scanner, match, validation);
    const syntheticConfig = await loadProject();
    return {
      framework: match.framework,
      projectName: syntheticConfig.config.name,
      baseUrl: syntheticConfig.config.baseUrl,
      routesInCode: result.routes.length,
      withFormRequest: result.withFormRequest,
      withoutFormRequest: result.withoutFormRequest,
      bodiesAdded: 0,
      queriesAdded: 0,
      zeroConfig: syntheticConfig.zeroConfig,
      configPath: syntheticConfig.configPath,
      manualEndpoints: syntheticConfig.manualEndpoints.length,
    };
  }

  // Camino B: legacy Laravel (incluye zero-config si no hay config).
  const { config, manualEndpoints, configPath } = await loadProject();
  const routes = await parseAllRoutes(config.filePrefixes);
  const specsForInference: EndpointSpec[] = routes.map((r) => ({
    name: r.uri,
    method: r.method as EndpointSpec["method"],
    uri: r.uri,
    headers: [],
    query: [],
    body: null,
  }));
  const inferStats = applyAgnosticInference(specsForInference);
  const inferredVars = inferCollectionVariables(
    specsForInference,
    config.variables,
  );

  // Recuento de rutas que parecen RESTful estándar (GET/POST/PUT/PATCH/DELETE).
  const restful = routes.filter((r) =>
    ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(r.method),
  );
  const withFr = routes.filter((r) => r.actionName).length;

  return {
    framework: match?.framework ?? "legacy",
    projectName: config.name,
    baseUrl: config.baseUrl,
    routesInCode: restful.length,
    withFormRequest: withFr,
    withoutFormRequest: restful.length - withFr,
    bodiesAdded: inferStats.bodiesAdded,
    queriesAdded: inferStats.queriesAdded,
    zeroConfig: false,
    configPath,
    manualEndpoints: manualEndpoints.length,
    // surface the inferred variables count even if not used downstream
    ...(inferredVars.length > 0 ? { manualEndpoints: manualEndpoints.length } : {}),
  } as IProjectSummary;
}
