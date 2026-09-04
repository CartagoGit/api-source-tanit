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
import type {
  EndpointSpec,
  IEndpointAuth,
} from "../../contracts/interfaces/core/postman.interface.js";
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import type {
  IDetectedFramework,
  IProjectMatch,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";
import { buildSpecsFromScanner } from "../adapters/parsed-route-to-spec.adapter.js";
import { endpointKey } from "../helpers/route-identity.helper.js";
import { authVariablesFor, detectAuthScheme } from "../domain/auth-scheme.service.js";
import { hasLoginEndpoint, applyAuthFlow, authEnvironmentVariables, detectLaravelTokenPath } from "../domain/auth-flow.service.js";
import { buildCollection } from "../domain/collection-builder.service.js";
import { applyAgnosticInference, inferCollectionVariables } from "../domain/param-inferrer.service.js";
import { loadProject } from "./project-loader.service.js";

import { resolveProjectContext } from "./project-context.service.js";
import { mergeWithManual } from "../domain/endpoint-merge.service.js";
import {
  buildServiceConfig,
  pickAuth,
  toIEndpointAuth,
} from "./auth-scheme.helper.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  IDetectedAuthScheme,
  IGenerationOptions,
  IGenerationResult,
} from "../../contracts/interfaces/core/discovery.interface.js";
import type { IEndpointProvenanceEntry } from "../../contracts/interfaces/core/merge.interface.js";
import {
  endpointSpecFromMerged,
  mergeEndpoints,
} from "./endpoint-merger.service.js";
import {
  detectMonorepo,
} from "./monorepo-detector.helper.js";
import type { IMonorepoDetection } from "../../contracts/interfaces/core/discovery.interface.js";
import type { IServiceDescriptor } from "../../contracts/interfaces/core/service-graph.interface.js";
import { toServiceGraph } from "./to-service-graph.helper.js";
import { deriveServiceId } from "./group-by-service.helper.js";
import { accumulateRoutesByService } from "./accumulate-routes-by-service.helper.js";

/**
 * Descubre los endpoints de un proyecto y construye su colección.
 *
 * `projectRoot` manda, y llega **como argumento** hasta abajo: el
 * contexto se resuelve una vez aquí y viaja explícito por el pipeline,
 * el loader y los scanners.
 *
 * Antes esto iba envuelto en `withProjectRoot()`, que fijaba variables
 * de entorno globales, ejecutaba y las restauraba. Funcionaba, pero al
 * precio de una cola: dos llamadas concurrentes se pisaban el estado,
 * así que había que serializarlas. Dos análisis a la vez tardaban lo que
 * la suma.
 *
 * Ya no. `tests/e2e/concurrent-projects.test.ts` genera dos proyectos de
 * frameworks distintos con `Promise.all` y comprueba que ninguno se
 * cruza: ni en endpoints, ni en nombre, ni en la raíz del contexto.
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

  const context = resolveProjectContext({ projectRoot });
  const result = await buildFor(context, options);
  // Legacy single-collection contract: si buildFor devuelve un
  // solo IGenerationResult (combineServices=true o un solo
  // servicio), lo devolvemos tal cual. Si devuelve array, el
  // caller NO ha pedido combinar, asi que elegimos el primer
  // servicio. Los callers que necesiten el array explicito usan
  // `generateCollections`.
  if (Array.isArray(result)) {
    const first: IGenerationResult = result[0] as IGenerationResult;
    return first;
  }
  return result as IGenerationResult;
}

/**
 * Variante multi-service de `generateCollection`. Devuelve TODAS
 * las colecciones, una por servicio, en el orden de descubrimiento.
 *
 * - Sin flag `--combine-services` y con N>1 servicios: array de N
 *   colecciones (cada una con `collectionName` derivado del
 *   serviceId).
 * - Con flag `--combine-services` o N===1: array de longitud 1
 *   (la coleccion legacy).
 *
 * El CLI genera un fichero por entrada; el plugin MCP y la web
 * exponen el array tal cual.
 */
export async function generateCollections(
  projectRoot: string,
  options: IGenerationOptions,
): Promise<ReadonlyArray<IGenerationResult>> {
  if (!existsSync(projectRoot)) {
    throw new Error(
      `El projectRoot no existe: ${projectRoot}\n` +
        "Comprueba la ruta que le pasas a `--project-root`.",
    );
  }
  const context = resolveProjectContext({ projectRoot });
  const result = await buildFor(context, options);
  if (Array.isArray(result)) {
    return result.slice() as ReadonlyArray<IGenerationResult>;
  }
  return [result as IGenerationResult];
}

async function buildFor(
  context: IProjectContext,
  options: IGenerationOptions,
): Promise<IGenerationResult | ReadonlyArray<IGenerationResult>> {
  const discovery = await discoverSpecs(context, options);

  // Camino legacy: cero matches (ningun scanner reconocio el proyecto,
  // ni legacy fallback). Sintetizamos un unico servicio con match null
  // para que `buildForService` corra el camino legacy completo
  // (`applyAgnosticInference` + `buildCollection` + auth flow). Si lo
  // saltaramos, los callers que esperan esos campos poblados (p. ej.
  // summary) verian valores vacios sin saber por que.
  if (discovery.matches.length === 0) {
    const synthetic: IProjectMatch = {
      framework: "unknown",
      projectRoot: context.projectRoot,
      artifacts: [],
    };
    return buildForService(
      { ...discovery, matches: [synthetic] },
      {
        serviceId: "default",
        match: synthetic,
        endpoints: discovery.routes,
        baseUrl: null,
        auth: undefined,
        variables: [],
      },
      context,
      options,
    );
  }

  // a00013 S3: calculamos el ServiceGraph. En un proyecto plano
  // produce length=1 (legacy path); en multi-service con
  // combineServices=false, produce N servicios que emitimos como
  // colecciones separadas.
  const combined = options.combineServices === true;
  const graph = toServiceGraph({
    matches: discovery.matches,
    routesByService: discovery.routesByService,
    monorepoDetection: discovery.monorepoDetection,
    combined,
  });

  if (graph.services.length === 1 || combined) {
    return buildForService(discovery, graph.services[0]!, context, options);
  }
  const out: IGenerationResult[] = [];
  for (const service of graph.services) {
    out.push(await buildForService(discovery, service, context, options));
  }
  return out;
}

async function buildForService(
  discovery: IDiscovery,
  service: IServiceDescriptor,
  context: IProjectContext,
  options: IGenerationOptions,
): Promise<IGenerationResult> {
  const projectRoot = context.projectRoot;
  // S4: el descriptor ya se usa — no más `void service;`. Aplicamos
  // los overrides per-service (baseUrl + auth) sobre el resultado de
  // discovery. El trabajo se hace SIEMPRE sobre `localConfig`, una
  // copia de `discovery.config`: mutar el original contaminaría la
  // siguiente iteración del loop multi-service en `buildFor`. Es la
  // diferencia entre "una colección por servicio" y "N colecciones
  // con la misma baseUrl de la última iteración".
  //
  // Single-service path: `service.baseUrl === null` y `service.auth
  // === undefined`, así que `buildServiceConfig(config, service)`
  // produce una copia equivalente a la original (salvo el array de
  // variables, que también se copia por valor). Los 21 ejemplos
  // siguen pasando porque ese caso es el dominante.
  //
  // Spec filtering por `service.endpoints` queda para un slice
  // posterior (cuando un override por servicio pueda cambiar qué
  // endpoints entran); aquí todos los servicios ven los mismos
  // `discovery.specs`. La aceptación de S4 es authScheme + baseUrl
  // por servicio — el filtrado no se exige.
  const localConfig = buildServiceConfig(discovery.config, service);
  const specs = [...discovery.specs];
  const inference = applyAgnosticInference(specs);

  // Variables de colección: se derivan las que falten, respetando las
  // que el host ya declare (y el `baseUrl` que `buildServiceConfig`
  // acaba de clavar por servicio).
  localConfig.variables = inferCollectionVariables(specs, localConfig.variables ?? []);
  if (options.collectionName) localConfig.collectionName = options.collectionName;

  // El esquema de auth se resuelve ANTES de construir: decide qué
  // cabeceras lleva cada petición, así que no se puede parchear después.
  //
  // S4: la auth se resuelve per-service. El detector por-espec
  // (`detectAuthScheme`) corre sobre los specs del servicio; el
  // override del descriptor (`service.auth`) gana si está definido,
  // y `pickAuth` lo propaga sin colapsar el discriminante (revisión
  // de auditoría #16: un `{ kind: "scheme", scheme: "bearer" }` del
  // descriptor NUNCA termina como `{ kind: "none" }`). El resultado
  // vuelve a `IDetectedAuthScheme` para que `buildCollection`,
  // `applyAuthFlow` y `authVariablesFor` (todos consumidores de
  // `IDetectedAuthScheme`) vean la forma que esperan.
  const detectedFromSpecs = detectAuthScheme(specs, hasLoginEndpoint(specs));
  const projectWideFallback = toIEndpointAuth(detectedFromSpecs);
  const effectiveAuth = pickAuth(service, projectWideFallback);
  const authScheme: IDetectedAuthScheme =
    effectiveAuth !== undefined
      ? authSchemeFromEndpointAuth(effectiveAuth, service.match.framework)
      : detectedFromSpecs;
  const collection = buildCollection(specs, localConfig, authScheme);

  // El flujo de auth es parte del pipeline, no del script: si viviera
  // solo en `generate.script.ts`, ni los tests ni el gate lo
  // ejercitarían, que es justo lo que pasaba.
  const tokenResponsePath =
    localConfig.tokenResponsePath ?? (await detectLaravelTokenPath(projectRoot));
  const authFlow = applyAuthFlow(collection, {
    tokenResponsePath,
    loginEndpointName: localConfig.loginEndpointName,
  });
  // Las variables que hay que rellenar dependen del esquema: una API
  // key necesita `apiKey`, OAuth2 necesita `clientId` y `clientSecret`,
  // y el bearer las credenciales del login.
  const needed = [
    ...(authFlow ? authEnvironmentVariables() : []),
    ...authVariablesFor(authScheme),
  ];
  if (needed.length > 0) {
    const known = new Set(localConfig.variables.map((v) => v.key));
    localConfig.variables = [
      ...localConfig.variables,
      ...needed.filter((v) => {
        if (known.has(v.key)) return false;
        known.add(v.key);
        return true;
      }),
    ];
    collection.variable = localConfig.variables;
  }

  return {
    collection,
    specs,
    routes: discovery.routes,
    config: localConfig,
    match: discovery.match,
    origin: discovery.origin,
    authFlow,
    authScheme,
    context,
    warnings: discovery.warnings,
    frameworks: discovery.frameworks,
    project: discovery.project,
    ...(discovery.provenance ? { provenance: discovery.provenance } : {}),
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
): Promise<IDetectedFramework[]> {
  const forced = await options.orchestrator.forceFramework({
    projectRoot,
    framework: options.forceFramework!,
  });
  if (!forced) {
    const supported = options.orchestrator.supportedFrameworks().sort().join(", ");
    throw new Error(
      `No hay ningún scanner para "${options.forceFramework}".\n` +
        `  Frameworks disponibles: ${supported}`,
    );
  }
  return [forced];
}

/**
 * Resuelve el `frameworkSearchRoot` y lo pega a cada match detectado.
 *
 * La prioridad está documentada en `IGenerationOptions.frameworkSearchRoot`:
 * el override del usuario gana sobre la auto-detección de monorepo, y
 * la auto-detección solo se aplica cuando hay **exactamente un**
 * workspace. Con varios, no rellena nada: el orquestador prefiere
 * quedarse quieto a equivocarse.
 *
 * Devuelve una copia del array de entrada con los `match` reasignados.
 * `IProjectMatch` es `readonly`; lo que se devuelve es un objeto
 * nuevo con `frameworkSearchRoot` añadido cuando toca. Los campos
 * restantes se preservan por spread, así que el resto del pipeline no
 * tiene que saber que hubo augmentación.
 *
 * f00011 S3. La detección vive en `monorepo-detector.helper.ts`; este
 * wrapper es lo único que el pipeline invoca.
 */
/**
 * Reorienta la detección cuando la raíz no es donde vive el framework.
 * Ver `discoverSpecs()` para el contexto completo.
 *
 * Tres casos:
 *   1. **Override del usuario** (`--framework-search-root=apps/api`):
 *      escanea SOLO ese workspace y descarta lo que la raíz hubiera
 *      detectado (la raíz de un monorepo rara vez tiene frameworks).
 *      Devuelve los `match` ya con `frameworkSearchRoot` pegado, para
 *      que `applyFrameworkSearchRoot` no duplique el segmento.
 *   2. **Auto multi-workspace**: agrega los resultados de cada
 *      workspace a los de la raíz (deduplicados por
 *      framework + workspace). Cada `match` lleva su `frameworkSearchRoot`
 *      propio — `applyFrameworkSearchRoot` no actúa cuando ya está
 *      definido (su `frameworkSearchRoot` interno es `null`).
 *   3. **Auto single-workspace**: reemplaza la detección raíz (vacía)
 *      por la del workspace, porque la raíz solo orquesta.
 *
 * Sin monorepo y sin override: devuelve lo que la raíz detectó — el
 * camino legacy intacto.
 *
 * Audit 2026-09-04 (hallazgo P1 #1).
 */
async function expandMonorepoDetection(
  orchestrator: IGenerationOptions["orchestrator"],
  projectRoot: string,
  rootDetected: ReadonlyArray<IDetectedFramework>,
  userOverride: string | undefined,
  forceFramework: string | undefined,
): Promise<ReadonlyArray<IDetectedFramework>> {
  // Caso 0 (audit segunda revisión #5): `forceFramework` está
  // activo. El usuario ha decidido explícitamente "este proyecto
  // ES X", y `rootDetected` ya contiene ese framework (forzado vía
  // `forcedDetection`). NO re-deteccionamos: el manifest del
  // workspace podría no permitir autodetección, y el override del
  // usuario es autoritativo. Solo reorientamos `projectRoot` si el
  // usuario también pidió `frameworkSearchRoot`, para que los
  // scanners lean del workspace correcto.
  if (forceFramework && forceFramework.length > 0) {
    if (userOverride && userOverride.length > 0) {
      // Forzó framework + forzó workspace: propagamos ambos a cada
      // match (típicamente uno solo, pero podría ser varios si el
      // orquestador devolviera varios con la misma identidad).
      return rootDetected.map((c) => ({
        ...c,
        match: {
          ...c.match,
          projectRoot,
          frameworkSearchRoot: userOverride,
        },
      }));
    }
    // Forzó framework sin workspace: nada que expandir. Devolvemos
    // el resultado de forcedDetection tal cual.
    return rootDetected;
  }

  // Caso 1: override del usuario. Escaneamos solo el workspace que
  // pidió. Pegamos `frameworkSearchRoot` al match (relativo a la raíz)
  // y dejamos `projectRoot` apuntando a la raíz: el contrato de los
  // scanners (a00012 S1.b) es que hacen `resolve(projectRoot,
  // frameworkSearchRoot)` para llegar al workspace. Si
  // `projectRoot` ya fuera el workspace, `resolve(workspace,
  // workspace) = workspace/workspace` y los scanners no encuentran
  // sus fuentes.
  if (userOverride && userOverride.length > 0) {
    const workspaceRoot = join(projectRoot, userOverride);
    const perWorkspace = await orchestrator.detectAll(workspaceRoot);
    return perWorkspace.map((c) => ({
      ...c,
      match: {
        ...c.match,
        projectRoot,
        frameworkSearchRoot: userOverride,
      },
    }));
  }

  // Detección de monorepo. Si no hay, devolvemos lo de la raíz.
  const detection = await detectMonorepo(projectRoot);
  if (!detection.isMonorepo || detection.workspaceDirs.length === 0) {
    return rootDetected;
  }

  // Dedup por (framework, frameworkSearchRoot) para no repetir la
  // misma pareja si dos workspaces exponen el mismo framework.
  const seen = new Set<string>(
    rootDetected.map(
      (d) => `${d.match.framework}@${d.match.frameworkSearchRoot ?? ""}`,
    ),
  );

  // Helper: reorienta un match al workspace. Mismo contrato que
  // override — `projectRoot` queda como la raíz del monorepo y
  // `frameworkSearchRoot` es el segmento a aplicar.
  const reorient = (
    c: IDetectedFramework,
    workspace: string,
  ): IDetectedFramework => ({
    ...c,
    match: {
      ...c.match,
      projectRoot,
      frameworkSearchRoot: workspace,
    },
  });

  // Caso 3: single-workspace. La raíz sola no detecta nada; la
  // reemplazamos por la del workspace.
  if (detection.workspaceDirs.length === 1) {
    const workspace = detection.workspaceDirs[0]!;
    const workspaceRoot = join(projectRoot, workspace);
    const perWorkspace = await orchestrator.detectAll(workspaceRoot);
    return perWorkspace.map((c) => reorient(c, workspace));
  }

  // Caso 2: multi-workspace. Agregamos a lo que la raíz ya detectó,
  // fijando `frameworkSearchRoot` por entrada.
  const merged: IDetectedFramework[] = [...rootDetected];
  for (const workspace of detection.workspaceDirs) {
    if (workspace === "" || workspace === ".") continue;
    const workspaceRoot = join(projectRoot, workspace);
    const perWorkspace = await orchestrator.detectAll(workspaceRoot);
    for (const candidate of perWorkspace) {
      const rewritten = reorient(candidate, workspace);
      const key = `${rewritten.match.framework}@${workspace}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(rewritten);
    }
  }
  return merged;
}

async function applyFrameworkSearchRoot(
  detected: ReadonlyArray<IDetectedFramework>,
  projectRoot: string,
  userOverride: string | undefined,
): Promise<{
  readonly augmented: ReadonlyArray<IDetectedFramework>;
  readonly detection: IMonorepoDetection | null;
}> {
  // Caso 1: el usuario forzó `--framework-search-root` o
  // `delendai.config.json#frameworkSearchRoot`. El valor se valida
  // abajo (no debe tener barras iniciales ni `..`); lo que llega de la
  // CLI ya pasó por `readFlag`, lo que llega del plugin ya pasó por
  // zod. Aquí se queda como viene.
  if (userOverride && userOverride.length > 0) {
    if (!isSafeRelativeSubdir(userOverride)) {
      throw new Error(
        `--framework-search-root debe ser un subdirectorio relativo a projectRoot ` +
          `(sin "/" inicial, sin ".."). Recibido: "${userOverride}"`,
      );
    }
    return {
      augmented: detected.map((d) => augmentMatch(d, userOverride)),
      detection: null,
    };
  }

  // Caso 2: auto-detección por monorepo. Si la raíz no es un monorepo,
  // o lo es pero tiene varios workspaces, no se hace nada.
  const detection = await detectMonorepo(projectRoot);
  if (!detection.frameworkSearchRoot) {
    return { augmented: detected, detection };
  }
  return {
    augmented: detected.map((d) => augmentMatch(d, detection.frameworkSearchRoot!)),
    detection,
  };
}

/**
 * Convierte el override de auth por operación (`spec.auth`) en un
 * `IDetectedAuthScheme` que el merger pueda comparar pieza a pieza.
 *
 * Audit 2ª revisión #16: el contrato `IEndpointAuth` tiene un
 * discriminante `kind: "none" | "scheme"` y `scheme: "bearer" |
 * "apiKey" | "oauth2"` como sub-discriminante. La conversión debe
 * respetar TODAS las ramas; si no, una expresión
 * `{ kind: "scheme", scheme: "apiKey" }` colapsaría a
 * `type: "none"` (público), que es exactamente el bug opuesto al
 * que arregló la primera auditoría.
 *
 * Cada rama lleva además una `evidence` trazable al framework de
 * origen: el merger la expone en el aviso CLI para que el usuario
 * pueda auditar por qué un endpoint se considera público / bearer /
 * apiKey / oauth2.
 */
function authSchemeFromEndpointAuth(
  auth: IEndpointAuth,
  framework: string,
): IDetectedAuthScheme {
  switch (auth.kind) {
    case "none":
      return {
        type: "none",
        evidence: `per-op override (${framework}, public)`,
      };
    case "scheme": {
      // Mapea sub-discriminante del contrato al `type` que el
      // merger ya entiende. Si en el futuro aparece
      // `scheme: "basic"` u otro, este switch lo enumera
      // explícitamente — nunca inventar un `type` por defecto.
      switch (auth.scheme) {
        case "bearer":
          return {
            type: "bearer",
            evidence: `per-op override (${framework}, bearer)`,
          };
        case "apiKey":
          return {
            type: "apikey",
            keyIn: "header",
            evidence: `per-op override (${framework}, apiKey header)`,
          };
        case "oauth2":
          return {
            type: "oauth2",
            evidence: `per-op override (${framework}, oauth2)`,
          };
      }
    }
  }
}

/**
 * Construye un `IDetectedFramework` con el `frameworkSearchRoot` pegado
 * al `match`. Se preserva el resto (score, evidence, scanner,
 * validation) por spread.
 */
function augmentMatch(
  detected: IDetectedFramework,
  frameworkSearchRoot: string,
): IDetectedFramework {
  const match: IProjectMatch = {
    framework: detected.match.framework,
    projectRoot: detected.match.projectRoot,
    artifacts: detected.match.artifacts,
    ...(detected.match.version !== undefined
      ? { version: detected.match.version }
      : {}),
    frameworkSearchRoot,
  };
  return {
    match,
    score: detected.score,
    evidence: detected.evidence,
    scanner: detected.scanner,
    validation: detected.validation,
  };
}

/**
 * ¿Es un segmento relativo seguro para usar como `frameworkSearchRoot`?
 *
 * Las dos trampas que evita:
 *  - Absoluto (`/etc/passwd`, `C:\…`): nunca se acepta; la raíz la
 *    fija el orquestador y este campo solo añade un segmento.
 *  - Escape (`..`, `apps/../../etc`): si el usuario lo escribe y nadie
 *    lo para, un scanner puede acabar leyendo fuera del proyecto. Los
 *    scanners ya hacen `join(match.projectRoot, match.frameworkSearchRoot)`,
 *    y `path.join` colapsa los `..`, así que la única defensa está aquí.
 */
function isSafeRelativeSubdir(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false;
  if (value.includes("..")) return false;
  if (value.includes("\0")) return false;
  return true;
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
  /** Provenance por endpoint, presente solo cuando la detección fue híbrida. */
  readonly provenance?: ReadonlyArray<IEndpointProvenanceEntry>;
  /** Matches que sobrevivieron al filtro `scanner !== null`. a00013 S3. */
  readonly matches: ReadonlyArray<IProjectMatch>;
  /** Rutas agrupadas por serviceId (a00013 S3, alimenta a `toServiceGraph`). */
  readonly routesByService: ReadonlyMap<string, ReadonlyArray<ParsedRoute>>;
  /** Resultado de `detectMonorepo`; `undefined` para proyectos planos. */
  readonly monorepoDetection: IMonorepoDetection | undefined;
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
  // Detección base contra la raíz (path rápido: un único framework en
  // la raíz del proyecto — los 21 ejemplos caen aquí).
  const rootDetected = options.forceFramework
    ? await forcedDetection(options, context.projectRoot)
    : await options.orchestrator.detectAll(context.projectRoot);

  // En monorepos (incluso single-workspace) y cuando el usuario
  // fuerza `--framework-search-root`, la detección raíz suele
  // devolver vacío: la raíz del monorepo solo orquesta, no contiene
  // los frameworks. Antes el helper devolvía `frameworkSearchRoot:
  // null` y el pipeline se quedaba con 0 endpoints en silencio.
  //
  // `expandMonorepoDetection` reescribe la detección cuando
  // corresponde: para override escanea SOLO el workspace que el
  // usuario pidió; para auto-detección multi-workspace escanea cada
  // workspace y agrega; para single-workspace reemplaza la raíz
  // (vacía) por la del workspace. Sin override ni monorepo, devuelve
  // lo que la raíz detectó — el camino legacy.
  //
  // Audit 2026-09-04 (hallazgo P1 #1) + segunda revisión: cuando
  // `forceFramework` está activo, la detección raíz ya contiene ese
  // framework concreto. Expandirla hacia `detectAll(workspaceRoot)`
  // perdería el force: el manifest del workspace podría no permitir
  // detectarlo (caso típico: dependencias declaradas en otro sitio,
  // manifest generado en build). `expandMonorepoDetection` recibe
  // el `forceFramework` para respetar la decisión del usuario y
  // reorientar el match existente en vez de re-detectar.
  //
  // Audit 2026-09-04 (segunda revisión #5): --framework + monorepo
  // debe seguir forzando ese framework, no autodetectarlo en cada
  // workspace.
  const expanded = await expandMonorepoDetection(
    options.orchestrator,
    context.projectRoot,
    rootDetected,
    options.frameworkSearchRoot,
    options.forceFramework,
  );
  const { augmented: detected, detection: monorepoDetection } =
    await applyFrameworkSearchRoot(
      expanded,
      context.projectRoot,
      options.frameworkSearchRoot,
    );
  // Con `context`: el loader deja de preguntarle al singleton qué
  // proyecto es este. Era el único sitio del pipeline que aún lo hacía,
  // y el motivo de que la llamada entera tuviera que ir envuelta.
  //
  // `argv` se pasa **explícito y vacío** por defecto: el core no lee
  // `process.argv` en runtime. Quien invoca el pipeline (CLI, plugin
  // MCP, UI web, tests) decide qué pasar. Si se omite, `loadProject`
  // trata la ausencia como "ningún flag `--config`" — comportamiento
  // documentado en `a00012 S4` y verificado por
  // `tests/core/process-argv-free.spec.ts`.
  const { config, manualEndpoints, configPath, zeroConfig } = await loadProject(
    options.argv ?? [],
    context,
  );
  const project = { zeroConfig, configPath, manualEndpoints: manualEndpoints.length };
  const usable = detected.filter((candidate) => candidate.scanner !== null);

  // Si la raíz era un monorepo y la auto-detección eligió el único
  // workspace, se avisa. La idea es que un usuario que lanza el CLI
  // sin saber qué es `frameworkSearchRoot` vea por qué el escaneo se
  // concentró en `apps/api` y no en la raíz.
  const warnings: string[] = [];
  if (
    monorepoDetection?.frameworkSearchRoot &&
    !options.frameworkSearchRoot
  ) {
    warnings.push(
      `Monorepo detectado por ${monorepoDetection.signal}: el escaneo se ` +
        `limita al workspace "${monorepoDetection.frameworkSearchRoot}". ` +
        `Si quieres escanear otro, pásalo con --framework-search-root.`,
    );
  }

  if (usable.length > 0) {
    // Se escanean TODOS los que reconocen el proyecto, no solo el
    // primero. Un repo con un Express heredado y rutas nuevas de
    // Next.js casa con dos, y quedarse con el ganador devolvía 1 de 3
    // endpoints en silencio. Los proyectos de un solo framework —los
    // 12 ejemplos— casan con un único detector, así que para ellos
    // esto no cambia nada.
    const specs: EndpointSpec[] = [];
    const routes: ParsedRoute[] = [];
    let withValidation = 0;
    let withoutValidation = 0;
    /** Lo que devuelve cada scanner, con su framework y score, para el merger. */
    interface IPerScanner {
      readonly framework: string;
      readonly scannerScore: number;
      readonly scannerSpecs: ReadonlyArray<EndpointSpec>;
      /**
       * Identidad del workspace / servicio del que vienen los specs.
       * Audit 2ª revisión #3: en monorepos multi-workspace, dos
       * endpoints `GET /health` de workspaces distintos NO deben
       * fusionarse. El merger usa `serviceId` para mantener la
       * separación. Cadena vacía = proyecto plano (no aplica).
       */
      readonly serviceId: string;
    }
    const perScanner: IPerScanner[] = [];

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
      perScanner.push({
        framework: candidate.match.framework,
        scannerScore: candidate.score,
        scannerSpecs: result.specs,
        serviceId: candidate.match.frameworkSearchRoot ?? "",
      });

      // Un proveedor de validación que falla no aborta la generación
      // —un endpoint sin reglas sigue siendo una colección válida— pero
      // tampoco puede pasar en silencio: era indistinguible de un
      // endpoint que legítimamente no valida nada, y así un parser roto
      // degradaba la colección entera sin que nadie lo notase.
      if (result.validationFailures.length > 0) {
        warnings.push(
          `${result.validationFailures.length} endpoint(s) of ` +
            `${candidate.match.framework} have validation rules that could not ` +
            `be read; their bodies come from the agnostic inference instead. ` +
            `First one: ${result.validationFailures[0]}`,
        );
      }
    }

    let provenance: ReadonlyArray<IEndpointProvenanceEntry> | undefined;

    if (usable.length > 1) {
      const names = usable.map((c) => `${c.match.framework} (${c.score})`).join(", ");
      warnings.push(
        `El proyecto encaja con ${usable.length} frameworks: ${names}. ` +
          "Se han escaneado todos y se han fusionado los endpoints. " +
          "Si alguno sobra, acota el escaneo con `--project-root` a la carpeta que toque.",
      );

      // Fusión híbrida: cada scanner aporta sus specs con su framework.
      // El merger agrupa por identidad (method + uri + name +
      // serviceId) y elige pieza a pieza (body, fields, auth,
      // description) al de mayor confianza, dejando provenance de
      // quién aportó qué. Antes hacía "first wins" sobre los specs
      // ya mezclados, que perdía sin aviso la información del resto.
      const candidates = perScanner.flatMap(({ framework, scannerScore, scannerSpecs, serviceId }) =>
        scannerSpecs.map((spec) => ({
          framework,
          scannerScore,
          serviceId,
          method: spec.method,
          uri: spec.uri,
          ...(spec.name !== undefined && spec.name !== ""
            ? { name: spec.name }
            : {}),
          ...(spec.body !== undefined ? { body: spec.body } : {}),
          ...(spec.fields ? { fields: spec.fields } : {}),
          ...(spec.description !== undefined
            ? { description: spec.description }
            : {}),
          // Audit 2026-09-04 P1 #6: el override por operación del
          // esquema de auth (`spec.auth`) debe sobrevivir a la
          // fusión. Antes el merger solo veía `body / fields /
          // description` y se perdía `auth: { kind: "none" }` para
          // /auth/login — el endpoint fusionado salía con la auth
          // global aunque el scanner ya había pedido explícitamente
          // "público". Audit 2ª revisión #16: el mapeo debe ser
          // EXHAUSTIVO por discriminante — antes todo `spec.auth`
          // colapsaba a `type: "none"`, lo que significaba que un
          // futuro `{ kind: "scheme", scheme: "apiKey" }` quedaría
          // como endpoint público. Ahora cada rama del union se
          // traduce a su `authScheme` correspondiente.
          ...(spec.auth !== undefined
            ? { authScheme: authSchemeFromEndpointAuth(spec.auth, framework) }
            : {}),
        })),
      );

      const mergedOutcome = mergeEndpoints(candidates);
      const merged = mergedOutcome.specs.map(endpointSpecFromMerged);
      provenance = mergedOutcome.provenance;
      for (const w of mergedOutcome.warnings) warnings.push(w);

      const collisions = specs.length - merged.length;
      if (collisions > 0) {
        warnings.push(
          `${collisions} endpoint(s) estaban declarados por más de un ` +
            "framework y se han fusionado pieza a pieza " +
            "(route + body + auth + description) con provenance.",
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
        provenance,
        matches: usable.map((c) => c.match),
        routesByService: accumulateRoutesByService(perScanner, routes),
        monorepoDetection: monorepoDetection ?? undefined,
      };
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
      matches: usable.map((c) => c.match),
      routesByService: new Map([
        [deriveServiceId(usable[0]!.match), routes],
      ]),
      monorepoDetection: monorepoDetection ?? undefined,
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
      matches: [],
      routesByService: new Map(),
      monorepoDetection: undefined,
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
    matches: [],
    routesByService: new Map(),
    monorepoDetection: undefined,
  };
}

/**
 * Quita endpoints repetidos.
 *
 * En un proyecto híbrido dos frameworks pueden declarar la misma ruta
 * (un proxy de Next.js delante de un Express, por ejemplo). Gana el
 * primero, que viene del detector con más confianza.
 *
 * La clave incluye el **nombre**, no solo método y URI. Con REST bastan
 * los dos primeros porque la URL identifica la operación; con GraphQL no
 * hay más que **un** endpoint —`POST /graphql`— y lo que distingue una
 * consulta de otra es el cuerpo. Deduplicando solo por método y URI, un
 * esquema de veinte operaciones producía **una** request.
 *
 * Lo mismo vale para cualquier RPC sobre POST, que es una forma de API
 * bastante más común que el caso híbrido para el que se escribió esto.
 */
function dedupeSpecs(specs: ReadonlyArray<EndpointSpec>): EndpointSpec[] {
  const seen = new Set<string>();
  const out: EndpointSpec[] = [];
  for (const spec of specs) {
    const key = endpointKey({ method: spec.method, uri: spec.uri, name: spec.name });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spec);
  }
  return out;
}
