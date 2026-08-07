/**
 * Pipeline de generación: `projectRoot` → `PostmanCollection`.
 *
 * Es el único sitio donde se decide el orden de los pasos:
 *
 *   1. Detectar el framework (con el catálogo que le inyecten).
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
import type { EndpointSpec, PostmanCollection } from "../contracts/postman.interface.js";
import type { ProjectConfig } from "../contracts/project-config.interface.js";
import type { IProjectContext } from "../contracts/project-context.interface.js";
import type { IProjectMatch, ParsedRoute } from "../contracts/scanner.interface.js";
import { buildSpecsFromScanner } from "../adapters/parsed-route-to-spec.adapter.js";
import {
  authVariablesFor,
  detectAuthScheme,
  type IDetectedAuthScheme,
} from "../domain/auth-scheme.service.js";
import {
  hasLoginEndpoint,
  applyAuthFlow,
  authEnvironmentVariables,
  detectLaravelTokenPath,
  type IAuthFlow,
} from "../domain/auth-flow.service.js";
import { buildCollection } from "../domain/collection-builder.service.js";
import type { ILegacyDiscovery } from "../contracts/legacy-discovery.interface.js";
import {
  applyAgnosticInference,
  inferCollectionVariables,
} from "../domain/param-inferrer.service.js";
import { loadProject } from "./project-loader.service.js";
import { withProjectRoot } from "./paths.service.js";
import { resolveProjectContext } from "./project-context.service.js";
import type { DiscoveryOrchestrator } from "./discovery.orchestrator.js";
import { mergeWithManual } from "../domain/endpoint-merge.service.js";
import { existsSync } from "node:fs";

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
  /** Flujo de sesión cableado, o `null` si el proyecto no expone login. */
  readonly authFlow: IAuthFlow | null;
  /**
   * Esquema de autenticación detectado, con su evidencia.
   *
   * Se expone para que los exportadores a otros formatos no lo deduzcan
   * cada uno por su cuenta: cinco detecciones paralelas acabarían
   * discrepando, y el mismo proyecto diría bearer en Postman y nada en
   * Insomnia.
   */
  readonly authScheme: IDetectedAuthScheme;
  /** Contexto resuelto del proyecto. */
  readonly context: IProjectContext;
  /**
   * Avisos para la persona que ejecuta esto. No son errores: la
   * colección se ha generado igual. Son las cosas que, de no decirse,
   * dejan a alguien con una colección a la que le falta media API sin
   * que lo sepa.
   */
  readonly warnings: ReadonlyArray<string>;
  /** Todos los frameworks que reconocieron el proyecto, no solo el ganador. */
  readonly frameworks: ReadonlyArray<string>;
  /**
   * De dónde salió la configuración.
   *
   * Lo necesita `summary` para decir si el proyecto trae config propia
   * o va en zero-config. El pipeline ya lo sabe porque llama a
   * `loadProject()`; exponerlo evita que el consumidor lo vuelva a
   * cargar y se arriesgue a leer otra cosa.
   */
  readonly project: {
    readonly zeroConfig: boolean;
    readonly configPath: string;
    readonly manualEndpoints: number;
  };
  readonly metrics: IGenerationMetrics;
}

/** Ajustes opcionales del pipeline. */
export interface IGenerationOptions {
  /** Sobrescribe `config.collectionName` (flag `--basename`). */
  readonly collectionName?: string;
  /**
   * Catálogo de frameworks que se va a usar para detectar y escanear.
   *
   * Es obligatorio a propósito. Antes el pipeline importaba
   * `defaultOrchestrator()` del registro concreto, y eso metía los 12
   * scanners dentro del núcleo: `core` no podía compilarse, ni
   * testearse, ni razonarse sin arrastrar Laravel, Gin y Spring Boot.
   * Un núcleo que dice ser agnóstico no puede tener una arista hacia lo
   * concreto.
   *
   * Quien compone la aplicación (los comandos del CLI, el plugin, los
   * tests) decide qué catálogo inyecta. Para el catálogo completo hay
   * `generateWithAllFrameworks()` en `frameworks/`.
   */
  readonly orchestrator: DiscoveryOrchestrator;
  /**
   * Qué hacer cuando ningún scanner reconoce el proyecto.
   *
   * Opcional: sin fallback, un proyecto no reconocido devuelve cero
   * endpoints, que es una respuesta honesta. El CLI inyecta la
   * heurística de Laravel por compatibilidad con los proyectos que
   * usaban esto antes de que existieran los scanners.
   */
  readonly legacyFallback?: ILegacyDiscovery | undefined;
  /**
   * Framework a usar, saltándose la detección.
   *
   * Para cuando la autodetección no puede acertar: un monorepo cuyo
   * manifiesto está en la raíz, una dependencia con alias, un
   * manifiesto que se genera en el build. Quien ejecuta esto sabe de
   * qué es su API; no poder decírselo convierte un caso resoluble en un
   * callejón sin salida.
   */
  readonly forceFramework?: string | undefined;
}

/**
 * Descubre los endpoints de un proyecto y construye su colección.
 *
 * `projectRoot` manda: la llamada se envuelve en `withProjectRoot()`, así
 * que dos proyectos generados en el mismo proceso no se pisan aunque los
 * servicios de dentro sigan resolviendo rutas por el singleton de
 * `paths.service` (p00017 S3).
 */
export async function generateCollection(
  projectRoot: string,
  options: IGenerationOptions,
): Promise<IGenerationResult> {
  // Una raíz que no existe es un error de quien llama, no un proyecto
  // vacío. Sin esto, un `--project-root` con una errata devolvía una
  // colección de cero endpoints sin decir por qué — y `summary` sí
  // lanzaba, así que además los dos caminos no se parecían.
  if (!existsSync(projectRoot)) {
    throw new Error(
      `El projectRoot no existe: ${projectRoot}\n` +
        "Comprueba la ruta que le pasas a `--project-root`.",
    );
  }

  // El contexto se resuelve UNA vez y se pasa hacia abajo. El
  // `withProjectRoot` sigue envolviendo la llamada porque `loadProject()`
  // y algún servicio todavía leen el singleton de `paths.service`
  // (p00017 S3, en curso); en cuanto todos reciban contexto, sobra.
  const context = resolveProjectContext({ projectRoot });
  return withProjectRoot(projectRoot, () => buildFor(context, options));
}

async function buildFor(
  context: IProjectContext,
  options: IGenerationOptions,
): Promise<IGenerationResult> {
  const projectRoot = context.projectRoot;
  const discovery = await discoverSpecs(context, options);

  // Inferencia agnóstica de body/query para lo que no traiga reglas.
  const specs = [...discovery.specs];
  const inference = applyAgnosticInference(specs);

  // Variables de colección: se derivan las que falten, respetando las
  // que el host ya declare.
  const config = discovery.config;
  config.variables = inferCollectionVariables(specs, config.variables ?? []);
  if (options.collectionName) config.collectionName = options.collectionName;

  // El esquema de auth se resuelve ANTES de construir: decide qué
  // cabeceras lleva cada petición, así que no se puede parchear después.
  const authScheme = detectAuthScheme(specs, hasLoginEndpoint(specs));
  const collection = buildCollection(specs, config, authScheme);

  // El flujo de auth es parte del pipeline, no del script: si viviera
  // solo en `generate.script.ts`, ni los tests ni el gate lo
  // ejercitarían, que es justo lo que pasaba.
  const tokenResponsePath =
    config.tokenResponsePath ?? (await detectLaravelTokenPath(projectRoot));
  const authFlow = applyAuthFlow(collection, {
    tokenResponsePath,
    loginEndpointName: config.loginEndpointName,
  });
  // Las variables que hay que rellenar dependen del esquema: una API
  // key necesita `apiKey`, OAuth2 necesita `clientId` y `clientSecret`,
  // y el bearer las credenciales del login.
  const needed = [
    ...(authFlow ? authEnvironmentVariables() : []),
    ...authVariablesFor(authScheme),
  ];
  if (needed.length > 0) {
    const known = new Set(config.variables.map((v) => v.key));
    config.variables = [
      ...config.variables,
      ...needed.filter((v) => {
        if (known.has(v.key)) return false;
        known.add(v.key);
        return true;
      }),
    ];
    collection.variable = config.variables;
  }

  return {
    collection,
    specs,
    routes: discovery.routes,
    config,
    match: discovery.match,
    origin: discovery.origin,
    authFlow,
    authScheme,
    context,
    warnings: discovery.warnings,
    frameworks: discovery.frameworks,
    project: discovery.project,
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

/**
 * Resuelve el framework forzado, o falla diciendo cuáles hay.
 *
 * Falla **antes** de escanear: un id mal escrito que se descubre al
 * final, después de recorrer el proyecto y con cero endpoints, no dice
 * nada de lo que ha pasado.
 */
async function forcedDetection(
  options: IGenerationOptions,
  projectRoot: string,
): Promise<Awaited<ReturnType<DiscoveryOrchestrator["detectAll"]>>> {
  const forced = await options.orchestrator.forceFramework(
    projectRoot,
    options.forceFramework!,
  );
  if (!forced) {
    const supported = options.orchestrator.supportedFrameworks().sort().join(", ");
    throw new Error(
      `No hay ningún scanner para "${options.forceFramework}".\n` +
        `  Frameworks disponibles: ${supported}`,
    );
  }
  return [forced];
}

interface IDiscovery {
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly routes: ReadonlyArray<ParsedRoute>;
  readonly config: ProjectConfig;
  readonly match: IProjectMatch | null;
  readonly origin: "scanner" | "legacy";
  readonly withValidation: number;
  readonly withoutValidation: number;
  readonly warnings: ReadonlyArray<string>;
  /** Todos los frameworks que reconocieron el proyecto. */
  readonly frameworks: ReadonlyArray<string>;
  readonly project: IGenerationResult["project"];
}

/**
 * Paso 1-3: detección, escaneo y merge de overrides.
 *
 * Todos los frameworks pasan por su scanner, Laravel incluido. El camino
 * legacy solo entra cuando el orchestrator no reconoce el proyecto, y es
 * una heurística zero-config sobre `routes/`.
 */
async function discoverSpecs(
  context: IProjectContext,
  options: IGenerationOptions,
): Promise<IDiscovery> {
  const detected = options.forceFramework
    ? await forcedDetection(options, context.projectRoot)
    : await options.orchestrator.detectAll(context.projectRoot);
  const { config, manualEndpoints, configPath, zeroConfig } = await loadProject();
  const project = { zeroConfig, configPath, manualEndpoints: manualEndpoints.length };
  const usable = detected.filter((candidate) => candidate.scanner !== null);

  if (usable.length > 0) {
    // Se escanean TODOS los que reconocen el proyecto, no solo el
    // primero. Un repo con un Express heredado y rutas nuevas de
    // Next.js casa con dos, y quedarse con el ganador devolvía 1 de 3
    // endpoints en silencio. Los proyectos de un solo framework —los
    // 12 ejemplos— casan con un único detector, así que para ellos
    // esto no cambia nada.
    const specs: EndpointSpec[] = [];
    const routes: ParsedRoute[] = [];
    const warnings: string[] = [];
    let withValidation = 0;
    let withoutValidation = 0;

    for (const candidate of usable) {
      const result = await buildSpecsFromScanner(
        candidate.scanner!,
        candidate.match,
        candidate.validation,
      );
      specs.push(...result.specs);
      routes.push(...result.routes);
      withValidation += result.withFormRequest;
      withoutValidation += result.withoutFormRequest;
    }

    if (usable.length > 1) {
      const names = usable.map((c) => `${c.match.framework} (${c.score})`).join(", ");
      warnings.push(
        `El proyecto encaja con ${usable.length} frameworks: ${names}. ` +
          "Se han escaneado todos y se han fusionado los endpoints. " +
          "Si alguno sobra, acota el escaneo con `--project-root` a la carpeta que toque.",
      );
    }

    const merged = dedupeSpecs(specs);
    if (merged.length < specs.length) {
      warnings.push(
        `${specs.length - merged.length} endpoint(s) estaban declarados por más de un ` +
          "framework y se han fusionado por método + URI.",
      );
    }

    return {
      specs: mergeWithManual(merged, [...manualEndpoints]),
      routes,
      config,
      match: usable[0]!.match,
      origin: "scanner",
      withValidation,
      withoutValidation,
      warnings,
      frameworks: usable.map((c) => c.match.framework),
      project,
    };
  }

  if (!options.legacyFallback) {
    // Sin fallback y sin scanner que lo reconozca: cero endpoints. Es
    // preferible a inventarse una heurística que devuelva ruido.
    return {
      specs: [...manualEndpoints],
      routes: [],
      config,
      match: null,
      origin: "legacy",
      withValidation: 0,
      withoutValidation: 0,
      project,
      warnings: [
        "Ningún scanner ha reconocido este proyecto y no se ha inyectado " +
          "ninguna estrategia de último recurso: la colección sale vacía. " +
          "Mira docs/FRAMEWORKS.md para ver qué busca cada scanner.",
      ],
      frameworks: [],
    };
  }

  const legacy = await options.legacyFallback.discover(
    config,
    manualEndpoints,
    context,
  );
  return {
    specs: legacy.specs,
    routes: legacy.routes,
    config,
    match: null,
    origin: "legacy",
    withValidation: legacy.withValidation,
    withoutValidation: legacy.withoutValidation,
    project,
    warnings:
      legacy.routes.length === 0
        ? [
            "Ningún scanner ha reconocido el proyecto y la heurística de " +
              "último recurso tampoco ha encontrado rutas.",
          ]
        : [],
    frameworks: [],
  };
}

/**
 * Quita endpoints repetidos por método + URI.
 *
 * En un proyecto híbrido dos frameworks pueden declarar la misma ruta
 * (un proxy de Next.js delante de un Express, por ejemplo). Gana el
 * primero, que viene del detector con más confianza.
 */
function dedupeSpecs(specs: ReadonlyArray<EndpointSpec>): EndpointSpec[] {
  const seen = new Set<string>();
  const out: EndpointSpec[] = [];
  for (const spec of specs) {
    const key = `${spec.method} ${spec.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spec);
  }
  return out;
}
