/**
 * Pipeline de generación: `projectRoot` → `PostmanCollection`.
 *
 * Es el único sitio donde se decide el orden de los pasos:
 *
 *   1. Detectar el framework (orchestrator sobre el registry).
 *   2. Escanear rutas y resolver reglas de validación.
 *   3. Fusionar los overrides manuales del host.
 *   4. Inferir bodies y query params para lo que no tenga reglas.
 *   5. Derivar las variables de colección que falten.
 *   6. Construir la colección Postman.
 *
 * Existía copiado en tres sitios —`scripts/generate.script.ts`,
 * `tests/helpers/run-scanner.ts` y el gate de validación— y las tres
 * copias ya divergían: la del gate se saltaba el merge de variables del
 * host, con lo que las `{{pathParam}}` se quedaban sin declarar. Un gate
 * que ejecuta un pipeline distinto al del CLI no valida nada.
 *
 * El paso de enriquecido con variantes (`catalog-enricher`) y la
 * escritura a disco quedan fuera a propósito: son responsabilidad del
 * script, no del pipeline.
 */
import type { EndpointSpec, PostmanCollection } from "../contract/postman.interface.js";
import type { ProjectConfig } from "../contract/project-config.interface.js";
import type { IProjectMatch, ParsedRoute } from "../contract/scanner.interface.js";
import { buildSpecsFromScanner } from "./adapters/parsed-route-to-spec.adapter.js";
import { buildCollection } from "./collection-builder.service.js";
import { discoverEndpoints, mergeWithManual } from "./endpoint-discovery.service.js";
import {
  applyAgnosticInference,
  inferCollectionVariables,
} from "./param-inferrer.service.js";
import { loadProject } from "./project-loader.service.js";
import { defaultOrchestrator } from "./scanner-registry.js";

/** Métricas del descubrimiento, para informes y tests. */
export interface IGenerationMetrics {
  readonly routes: number;
  readonly specs: number;
  readonly withValidation: number;
  readonly withoutValidation: number;
  readonly bodiesInferred: number;
  readonly queriesInferred: number;
}

/** Resultado completo del pipeline. */
export interface IGenerationResult {
  readonly collection: PostmanCollection;
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly routes: ReadonlyArray<ParsedRoute>;
  readonly config: ProjectConfig;
  readonly match: IProjectMatch | null;
  /** `"scanner"` si lo resolvió un scanner del registry; `"legacy"` si no. */
  readonly origin: "scanner" | "legacy";
  readonly metrics: IGenerationMetrics;
}

/** Ajustes opcionales del pipeline. */
export interface IGenerationOptions {
  /** Sobrescribe `config.collectionName` (flag `--basename`). */
  readonly collectionName?: string;
}

/**
 * Descubre los endpoints de un proyecto y construye su colección.
 *
 * `projectRoot` debe ser la raíz del proyecto host. La configuración del
 * host (`config.constant.ts`, overrides manuales) se carga con
 * `loadProject()`, que hoy sigue dependiendo del singleton de
 * `paths.service` — ver p00017.
 */
export async function generateCollection(
  projectRoot: string,
  options: IGenerationOptions = {},
): Promise<IGenerationResult> {
  const discovery = await discoverSpecs(projectRoot);

  // Inferencia agnóstica de body/query para lo que no traiga reglas.
  const specs = [...discovery.specs];
  const inference = applyAgnosticInference(specs);

  // Variables de colección: se derivan las que falten, respetando las
  // que el host ya declare.
  const config = discovery.config;
  config.variables = inferCollectionVariables(specs, config.variables ?? []);
  if (options.collectionName) config.collectionName = options.collectionName;

  return {
    collection: buildCollection(specs, config),
    specs,
    routes: discovery.routes,
    config,
    match: discovery.match,
    origin: discovery.origin,
    metrics: {
      routes: discovery.routes.length,
      specs: specs.length,
      withValidation: discovery.withValidation,
      withoutValidation: discovery.withoutValidation,
      bodiesInferred: inference.bodiesAdded,
      queriesInferred: inference.queriesAdded,
    },
  };
}

interface IDiscovery {
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly routes: ReadonlyArray<ParsedRoute>;
  readonly config: ProjectConfig;
  readonly match: IProjectMatch | null;
  readonly origin: "scanner" | "legacy";
  readonly withValidation: number;
  readonly withoutValidation: number;
}

/**
 * Paso 1-3: detección, escaneo y merge de overrides.
 *
 * Todos los frameworks pasan por su scanner, Laravel incluido. El camino
 * legacy solo entra cuando el orchestrator no reconoce el proyecto, y es
 * una heurística zero-config sobre `routes/`.
 */
async function discoverSpecs(projectRoot: string): Promise<IDiscovery> {
  const { match, scanner, validation } = await defaultOrchestrator().detectProject(
    projectRoot,
  );
  const { config, manualEndpoints } = await loadProject();

  if (match && scanner) {
    const result = await buildSpecsFromScanner(scanner, match, validation);
    return {
      specs: mergeWithManual([...result.specs], [...manualEndpoints]),
      routes: result.routes,
      config,
      match,
      origin: "scanner",
      withValidation: result.withFormRequest,
      withoutValidation: result.withoutFormRequest,
    };
  }

  const legacy = await discoverEndpoints(config, [...manualEndpoints]);
  return {
    specs: legacy.specs,
    routes: legacy.routes,
    config,
    match: null,
    origin: "legacy",
    withValidation: legacy.withFormRequest,
    withoutValidation: legacy.withoutFormRequest,
  };
}
