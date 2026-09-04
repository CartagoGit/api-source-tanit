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
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
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
import { existsSync } from "node:fs";
import type {
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
  return buildFor(context, options);
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
 * En monorepos multi-workspace, expande la detección contra cada
 * workspace candidato. Ver `discoverSpecs()` para el contexto.
 *
 * Decisión de diseño: **solo** se expande cuando
 *   - la raíz es un monorepo detectado,
 *   - hay `>= 2` workspaces materializados,
 *   - no hay `frameworkSearchRoot` (override o auto con un único
 *     workspace).
 *
 * Con un único workspace, `applyFrameworkSearchRoot` ya lo resuelve
 * con el helper de monorepo: expandir aquí duplicaría trabajo.
 * Con override del usuario, esa indicación es autoritativa: expandir
 * ignoraría su intención.
 *
 * Los `match` resultantes llevan `frameworkSearchRoot` pegado, así
 * el resto del pipeline (scanners, validación, exporter) consume el
 * mismo contrato que ya tenía para el caso single-workspace.
 *
 * Audit 2026-09-04 (hallazgo P1 #1).
 */
async function expandMonorepoDetection(
  orchestrator: IGenerationOptions["orchestrator"],
  projectRoot: string,
  rootDetected: ReadonlyArray<IDetectedFramework>,
  userOverride: string | undefined,
): Promise<ReadonlyArray<IDetectedFramework>> {
  if (userOverride && userOverride.length > 0) return rootDetected;
  const detection = await detectMonorepo(projectRoot);
  if (
    !detection.isMonorepo ||
    detection.workspaceDirs.length < 2
  ) {
    return rootDetected;
  }
  const merged: IDetectedFramework[] = [...rootDetected];
  // Dedup por (framework, frameworkSearchRoot) para no repetir la
  // misma pareja si dos workspaces tienen el mismo framework. La
  // clave compuesta es lo que el merger ya entiende para agrupar.
  const seen = new Set<string>(
    rootDetected.map(
      (d) => `${d.match.framework}@${d.match.frameworkSearchRoot ?? ""}`,
    ),
  );
  for (const workspace of detection.workspaceDirs) {
    // Evita re-escanear la raíz si aparece como workspace (raro,
    // pero los globs pueden incluir ".").
    if (workspace === "" || workspace === ".") continue;
    const perWorkspace = await orchestrator.detectAll(projectRoot);
    for (const candidate of perWorkspace) {
      const key = `${candidate.match.framework}@${workspace}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(augmentMatch(candidate, workspace));
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
  // `mcp-vertex.config.json#frameworkSearchRoot`. El valor se valida
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

  // En monorepos con **varios** workspaces materializados, la
  // detección contra la raíz suele fallar: NestJS en `apps/api` no
  // aparece porque su `package.json` no está en la raíz. Antes el
  // helper devolvía `frameworkSearchRoot: null` y el usuario tenía
  // que pasar `--framework-search-root` manualmente, o se quedaba con
  // 0 endpoints en silencio.
  //
  // Cuando pasa eso y no hay override explícito, **expandimos** la
  // detección: corremos `detectAll` contra cada workspace candidato
  // y agregamos los resultados, etiquetando cada `match` con su
  // `frameworkSearchRoot` correspondiente. Es la pieza que faltaba
  // para que un monorepo "Nest + Next" se autodetecte sin
  // configuración.
  //
  // Audit 2026-09-04 (hallazgo P1 #1). El fix respeta el contrato
  // previo: si hay un único workspace, no cambia nada; si hay cero,
  // tampoco; si hay override, no se aplica.
  const expanded = await expandMonorepoDetection(
    options.orchestrator,
    context.projectRoot,
    rootDetected,
    options.frameworkSearchRoot,
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
      // El merger agrupa por identidad (method + uri + name) y elige
      // pieza a pieza (body, fields, auth, description) al de mayor
      // confianza, dejando provenance de quién aportó qué. Antes
      // hacía "first wins" sobre los specs ya mezclados, que perdía
      // sin aviso la información del resto.
      const candidates = perScanner.flatMap(({ framework, scannerScore, scannerSpecs }) =>
        scannerSpecs.map((spec) => ({
          framework,
          scannerScore,
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
