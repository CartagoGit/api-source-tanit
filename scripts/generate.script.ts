/**
 * Script principal: genera la colección Postman v2.1.0 descubriendo
 * automáticamente los endpoints desde `routes/*.php` + firmas de
 * controladores (FormRequest), y enriqueciendo con variantes.
 *
 * La configuración del host se carga de forma agnóstica vía
 * `loadProject()` (`--config`, `POSTMAN_CONFIG` o `examples/<proyecto>/config.constant.ts`).
 *
 * Uso:
 *   bun scripts/generate.script.ts
 *   bun scripts/generate.script.ts --config ./examples/example-app/config.constant.ts
 *   bun run build
 */
import { writeFile } from "node:fs/promises";
import {
  attachLoginAutoToken,
  buildCollection,
} from "../service/collection-builder.service.js";
import { discoverEndpoints } from "../service/endpoint-discovery.service.js";
import { enrichCatalogWithFormRequests } from "../service/catalog-enricher.service.js";
import { loadProject } from "../service/project-loader.service.js";
import {
  normalizeForComparison,
  stripApiPrefix,
} from "../helper/uri.helper.js";
import { countItems, walkCollection } from "../helper/postman.helper.js";
import {
  describeDiscoveredPaths,
  outputCollectionPath,
  outputEnvironmentPath,
} from "../service/paths.service.js";
import {
  applyAgnosticInference,
  inferCollectionVariables,
} from "../service/param-inferrer.service.js";
import {
  buildEnvironments,
  defaultEnvironments,
} from "../service/environment-builder.service.js";
import {
  DiscoveryOrchestrator,
  type DiscoveryRegistry,
} from "../service/discovery.orchestrator.js";
import {
  LaravelProjectScanner,
  LaravelScanner,
  LaravelFormRequestValidationProvider,
} from "../service/scanners/laravel.scanner.js";
import {
  OpenApiProjectScanner,
  OpenApiScanner,
  OpenApiValidationProvider,
} from "../service/scanners/openapi.scanner.js";
import {
  ExpressProjectScanner,
  ExpressScanner,
  ExpressZodValidationProvider,
} from "../service/scanners/express.scanner.js";
import {
  FastApiProjectScanner,
  FastApiScanner,
  FastApiPydanticValidationProvider,
} from "../service/scanners/fastapi.scanner.js";
import {
  SymfonyProjectScanner,
  SymfonyRouteScanner,
  SymfonyAttributesValidationProvider,
} from "../service/scanners/symfony.scanner.js";
import {
  NestJsProjectScanner,
  NestJsRouteScanner,
  NestJsClassValidatorProvider,
} from "../service/scanners/nestjs.scanner.js";
import {
  DjangoProjectScanner,
  DjangoRouteScanner,
  DjangoSerializerProvider,
} from "../service/scanners/django.scanner.js";
import {
  FlaskProjectScanner,
  FlaskRouteScanner,
  FlaskPydanticProvider,
} from "../service/scanners/flask.scanner.js";
import {
  NextJsProjectScanner,
  NextJsRouteScanner,
  NextJsZodProvider,
} from "../service/scanners/nextjs.scanner.js";
import {
  GinProjectScanner,
  GinRouteScanner,
  GinBindingProvider,
} from "../service/scanners/gin.scanner.js";
import {
  SpringBootProjectScanner,
  SpringBootRouteScanner,
  SpringBootBeanValidationProvider,
} from "../service/scanners/springboot.scanner.js";
import {
  AspNetProjectScanner,
  AspNetRouteScanner,
  AspNetDataAnnotationsProvider,
} from "../service/scanners/aspnet.scanner.js";
import { buildSpecsFromScanner } from "../service/adapters/parsed-route-to-spec.adapter.js";
import type { EndpointSpec } from "../contract/postman.interface.js";
import type { DiscoveredRoute } from "../contract/postman.interface.js";

/** Registry por defecto del orchestrator (orden = prioridad). */
const DEFAULT_REGISTRY: DiscoveryRegistry = {
  detectors: [
    new LaravelProjectScanner(),
    new OpenApiProjectScanner(),
    new FastApiProjectScanner(),
    new SymfonyProjectScanner(),
    new NestJsProjectScanner(),
    new DjangoProjectScanner(),
    new SpringBootProjectScanner(),
    new AspNetProjectScanner(),
    new FlaskProjectScanner(),
    new NextJsProjectScanner(),
    new GinProjectScanner(),
    new ExpressProjectScanner(),
  ],
  routeScanners: [
    new LaravelScanner(),
    new OpenApiScanner(),
    new FastApiScanner(),
    new SymfonyRouteScanner(),
    new NestJsRouteScanner(),
    new DjangoRouteScanner(),
    new SpringBootRouteScanner(),
    new AspNetRouteScanner(),
    new FlaskRouteScanner(),
    new NextJsRouteScanner(),
    new GinRouteScanner(),
    new ExpressScanner(),
  ],
  validationProviders: [
    new LaravelFormRequestValidationProvider(),
    new OpenApiValidationProvider(),
    new FastApiPydanticValidationProvider(),
    new SymfonyAttributesValidationProvider(),
    new NestJsClassValidatorProvider(),
    new DjangoSerializerProvider(),
    new SpringBootBeanValidationProvider(),
    new AspNetDataAnnotationsProvider(),
    new FlaskPydanticProvider(),
    new NextJsZodProvider(),
    new GinBindingProvider(),
    new ExpressZodValidationProvider(),
  ],
};

/** Tipos de los resultados del flujo legacy (Laravel-flavoured). */
interface LegacyDiscovery {
  readonly config: ReturnType<typeof loadProject> extends Promise<infer R>
    ? R extends { config: infer C }
      ? C
      : never
    : never;
  readonly manualEndpoints: ReadonlyArray<EndpointSpec>;
  readonly configPath: string;
  readonly endpointsPath: string | null;
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly routes: ReadonlyArray<DiscoveredRoute>;
  readonly withFormRequest: number;
  readonly withoutFormRequest: number;
  readonly origin: "orchestrator" | "legacy";
}

/**
 * Detecta heurísticamente el dot-path del token en el AuthController.
 * Mira los archivos `app/Http/Controllers/*Auth*Controller.php` y busca
 * patrones de respuesta. Si no encuentra nada, devuelve undefined.
 */
async function detectTokenPath(): Promise<string | undefined> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { projectRoot } = await import("../service/paths.service.js");
  const root = projectRoot();
  if (!root) return undefined;
  const ctlDir = path.join(root, "app/Http/Controllers");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(ctlDir);
  } catch {
    return undefined;
  }
  const authFiles = entries.filter(
    (f) => /Auth(entic|oriz)?/i.test(f) && f.endsWith("Controller.php"),
  );
  for (const f of authFiles) {
    const text = await fs.readFile(path.join(ctlDir, f), "utf8").catch(() => "");
    // Patrones comunes: 'access_token' => $t, 'data' => ['token' => ...]
    if (/'access_token'\s*=>/.test(text) || /"access_token"\s*=>/.test(text))
      return "access_token";
    if (/'token'\s*=>\s*\$/.test(text) || /"token"\s*=>\s*\$/.test(text)) {
      // JWT: token suele ir en raíz. Sanctum: suele ir en data.token.
      // Si hay 'data' => 'token', preferimos data.token.
      if (/'data'\s*=>\s*\[[\s\S]*?'token'\s*=>/.test(text)) return "data.token";
      return "token";
    }
    if (/'data'\s*=>\s*\[[\s\S]*?'access_token'\s*=>/.test(text))
      return "data.access_token";
  }
  return undefined;
}

/**
 * Punto de entrada del discovery framework-agnostic.
 *
 * Probar primero el orchestrator. Reglas:
 *   - Si el orchestrator encuentra un match con `framework !== "laravel"`,
 *     construir los specs con el adapter (zero-config) y saltarse el
 *     flujo legacy. Esto cubre OpenAPI, Express, FastAPI, etc.
 *   - Si el match es Laravel, el flujo legacy hace más cosas (zero-config
 *     del .env, builders de zona, etc.), así que seguimos usando ese.
 *   - Si no hay match, fallback al flujo legacy zero-config de Laravel.
 */
async function discoverEndpointsUniversal(): Promise<{
  specs: ReadonlyArray<EndpointSpec>;
  routes: ReadonlyArray<DiscoveredRoute>;
  withFormRequest: number;
  withoutFormRequest: number;
  config: LegacyDiscovery["config"];
  configPath: string;
  endpointsPath: string | null;
  manualEndpoints: ReadonlyArray<EndpointSpec>;
  origin: "orchestrator" | "legacy";
}> {
  console.log("→ Rutas detectadas:");
  console.log(describeDiscoveredPaths());

  const orch = new DiscoveryOrchestrator(DEFAULT_REGISTRY);
  const { match, scanner, validation } = await orch.detectProject(
    process.env.POSTMAN_PROJECT_ROOT ?? ".",
  );

  // Camino A: framework NO-Laravel → adapter directo (OpenAPI, etc.)
  if (match && scanner && match.framework !== "laravel") {
    console.log(`→ Orchestrator: framework=${match.framework} (no Laravel)`);
    const result = await buildSpecsFromScanner(scanner, match, validation);
    // Construir un ProjectConfig mínimo en memoria.
    const syntheticConfig = await loadProject();
    // Para OpenAPI, intenta usar `info.title` como collectionName.
    if (match.framework === "openapi") {
      try {
        const { readFile } = await import("node:fs/promises");
        const { resolve } = await import("node:path");
        const rel = match.artifacts[0];
        if (rel) {
          const abs = resolve(match.projectRoot, rel);
          const text = await readFile(abs, "utf8");
          const json = rel.endsWith(".json") ? JSON.parse(text) : null;
          const title = json?.info?.title;
          if (typeof title === "string" && title.trim().length > 0) {
            syntheticConfig.config.collectionName = `${title} (Postman)`;
            syntheticConfig.config.collectionDescription =
              typeof json?.info?.description === "string"
                ? json.info.description
                : `Colección generada desde ${rel}.`;
          }
        }
      } catch {
        /* usa defaults */
      }
    }
    return {
      specs: result.specs,
      routes: result.routes.map((r) => ({ method: r.method, uri: r.uri })),
      withFormRequest: result.withFormRequest,
      withoutFormRequest: result.withoutFormRequest,
      config: syntheticConfig.config,
      configPath: syntheticConfig.configPath,
      endpointsPath: syntheticConfig.endpointsPath,
      manualEndpoints: [],
      origin: "orchestrator",
    };
  }

  // Camino B: legacy Laravel (incluye zero-config si no hay config constant).
  console.log(
    match
      ? `→ Orchestrator: framework=${match.framework} → legacy Laravel flow`
      : "→ Orchestrator: no match → legacy Laravel flow (zero-config)",
  );
  const { config, manualEndpoints, configPath, endpointsPath } =
    await loadProject();
  console.log(`→ Config host: ${configPath}`);
  if (endpointsPath) {
    console.log(
      `→ Overrides manuales: ${endpointsPath} (${manualEndpoints.length})`,
    );
  } else {
    console.log("→ Overrides manuales: (ninguno)");
  }

  console.log("→ Descubriendo endpoints automáticamente…");
  const discovered = await discoverEndpoints(config, manualEndpoints);
  console.log(
    `  · ${discovered.routes.length} rutas en código, ${discovered.specs.length} specs ` +
      `(FormRequest: ${discovered.withFormRequest}, sin FR: ${discovered.withoutFormRequest}).`,
  );
  return {
    specs: discovered.specs,
    routes: discovered.routes,
    withFormRequest: discovered.withFormRequest,
    withoutFormRequest: discovered.withoutFormRequest,
    config,
    configPath,
    endpointsPath,
    manualEndpoints,
    origin: "legacy",
  };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const openAfter = args.includes("--open");
  const inspectMode = args.includes("--inspect");
  const outputIdx = args.indexOf("--output");
  const outputFlag = outputIdx !== -1 ? args[outputIdx + 1] ?? null : null;
  const basenameIdx = args.indexOf("--basename");
  const basenameFlag =
    basenameIdx !== -1 ? args[basenameIdx + 1] ?? null : null;
  const envsIdx = args.indexOf("--envs");
  const envsFlag =
    envsIdx !== -1
      ? (args[envsIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      : null;

  const {
    specs: discoveredSpecs,
    routes: discoveredRoutes,
    withFormRequest,
    withoutFormRequest,
    config,
    manualEndpoints,
    origin,
  } = await discoverEndpointsUniversal();

  // Modo --inspect: solo imprimir discovery, sin escribir archivos.
  // Pensado para que `summary` (y herramientas similares) puedan
  // consultar el estado del proyecto sin generar artefactos.
  if (inspectMode) {
    console.log("\n→ Modo --inspect (no se escriben artefactos)");
    console.log(`  · Framework:    ${origin}`);
    console.log(`  · ProjectName:  ${config.name}`);
    console.log(`  · Rutas:        ${discoveredRoutes.length}`);
    console.log(`  · Specs:        ${discoveredSpecs.length}`);
    console.log(`  · Con FR:       ${withFormRequest}`);
    console.log(`  · Sin FR:       ${withoutFormRequest}`);
    const inferStats = applyAgnosticInference([...discoveredSpecs]);
    console.log(`  · Bodies auto:  ${inferStats.bodiesAdded}`);
    console.log(`  · Queries auto: ${inferStats.queriesAdded}`);
    console.log(`  · BaseUrl:      ${config.baseUrl}`);
    return 0;
  }

  // Índice method+uri → FormRequest para el enricher
  const frIndex = new Map<string, string>();
  for (const s of discoveredSpecs) {
    if (!s.formRequest) continue;
    const key = `${s.method} ${normalizeForComparison(s.uri.replace(/^\//, ""))}`;
    frIndex.set(key, s.formRequest);
  }

  // Inferencia agnóstica de body/query para endpoints sin FormRequest.
  const inferStats = applyAgnosticInference([...discoveredSpecs]);
  console.log(
    `→ Inferencia agnóstica: ${inferStats.bodiesAdded} bodies + ${inferStats.queriesAdded} queries ` +
      `auto-rellenados.`,
  );

  // Variables de colección: si el host no las define, las derivamos.
  if (!config.variables || config.variables.length === 0) {
    config.variables = inferCollectionVariables([...discoveredSpecs], []);
  } else {
    // Añade cualquier {{pathParam}} que falte en las variables del host.
    const inferred = inferCollectionVariables(
      [...discoveredSpecs],
      config.variables,
    );
    config.variables = inferred;
  }

  console.log("→ Construyendo colección Postman…");
  // Override del collectionName ANTES de construir la colección.
  if (basenameFlag) {
    config.collectionName = basenameFlag;
  }
  const collection = buildCollection([...discoveredSpecs], config);
  const detectedTokenPath = config.tokenResponsePath ?? (await detectTokenPath());
  attachLoginAutoToken(collection, {
    loginEndpointName: config.loginEndpointName,
    loginEndpointHints: config.loginEndpointHints,
    tokenResponsePath: detectedTokenPath,
  });

  console.log("→ Enriqueciendo con variantes FormRequest…");
  const stats = await enrichCatalogWithFormRequests(collection, frIndex);
  console.log(`  · Variantes body:  ${stats.bodyVariants}`);
  console.log(`  · Variantes query: ${stats.queryVariants}`);
  console.log(`  · Resueltos FR:    ${stats.resolved}`);
  console.log(`  · Sin FR:          ${stats.unresolved}`);
  if (stats.rulesWithUnknown.length > 0) {
    console.log(
      `  · FR con reglas dinámicas: ${stats.rulesWithUnknown.length}`,
    );
  }

  // Cobertura bidireccional
  const sourceRoutes = new Map<string, DiscoveredRoute>();
  for (const r of discoveredRoutes) {
    // Solo Laravel (legacy) quita el prefijo `api/`. Otros frameworks
    // tienen prefix real (api/v1, etc.) y deben conservarse.
    const uri = origin === "legacy" ? stripApiPrefix(r.uri) : r.uri;
    const key = `${r.method} ${normalizeForComparison(uri)}`;
    sourceRoutes.set(key, { method: r.method, uri });
  }
  const declared = walkCollection(collection);
  const collectionRoutes = new Map<
    string,
    { method: string; uri: string; name: string }
  >();
  for (const r of declared) {
    const key = `${r.method} ${normalizeForComparison(r.uri)}`;
    collectionRoutes.set(key, r);
  }
  console.log(
    `  · ${declared.length} requests finales (${collectionRoutes.size} únicos method+uri).`,
  );

  const missingInSource: Array<{ method: string; uri: string; name: string }> =
    [];
  for (const [key, info] of collectionRoutes) {
    if (!sourceRoutes.has(key)) missingInSource.push(info);
  }
  const missingInCollection: DiscoveredRoute[] = [];
  for (const [key, info] of sourceRoutes) {
    if (info.uri === "auth-test") continue;
    if (!collectionRoutes.has(key)) missingInCollection.push(info);
  }
  if (missingInSource.length) {
    console.error(
      `\n✘ ${missingInSource.length} en colección pero NO en routes:`,
    );
    for (const m of missingInSource.slice(0, 20)) {
      console.error(`    ${m.method.padEnd(6)} /${m.uri} (${m.name})`);
    }
  }
  if (missingInCollection.length) {
    console.error(
      `\n✘ ${missingInCollection.length} en routes pero NO en colección:`,
    );
    for (const m of missingInCollection.slice(0, 20)) {
      console.error(`    ${m.method.padEnd(6)} /${m.uri}`);
    }
  }
  if (missingInSource.length || missingInCollection.length) {
    console.error("\n→ Generación abortada.");
    return 1;
  }

  // --output / --basename respetan variables de entorno + flags.
  if (basenameFlag) {
    process.env.POSTMAN_OUTPUT_BASENAME = basenameFlag;
  }
  const OUTPUT_PATH = outputFlag
    ? outputFlag
    : await outputCollectionPath(config.name);
  const json = JSON.stringify(collection, null, 2);
  await writeFile(OUTPUT_PATH, json + "\n", "utf8");
  const { requests, folders } = countItems(collection);
  const sizeKb = (json.length / 1024).toFixed(1);
  console.log(`\n✔ Colección escrita en ${OUTPUT_PATH}`);
  console.log(
    `  · ${requests} requests en ${folders} carpetas (${sizeKb} KB).`,
  );

  // --- Genera environments si --envs o config.environments ------------
  const configEnvs = config.environments
    ? [...config.environments]
    : [];
  if (envsFlag) {
    const auto = defaultEnvironments(config.baseUrl);
    const merged = [...configEnvs];
    for (const name of envsFlag) {
      const found = auto.find((e) => e.name.toLowerCase() === name.toLowerCase());
      if (found) merged.push(found);
      else
        merged.push({
          name,
          overrides: { baseUrl: config.baseUrl },
        });
    }
    config.environments = merged;
  }
  const envsToWrite = config.environments ?? [];
  for (const e of envsToWrite) {
    const envs = buildEnvironments([...discoveredSpecs], config.variables, [e]);
    const env = envs[0];
    if (!env) continue;
    const envPath = await outputEnvironmentPath(env.name, config.name);
    await writeFile(envPath, JSON.stringify(env, null, 2) + "\n", "utf8");
    console.log(
      `  · Environment "${env.name}" → ${envPath} (${env.values.length} vars)`,
    );
  }

  if (openAfter) {
    const { spawnSync } = await import("node:child_process");
    const start =
      (import.meta as { dir?: string }).dir ?? process.cwd();
    const openScript = `${start}/open-postman.script.ts`;
    console.log("\n→ --open: lanzando open-postman…");
    const r = spawnSync(
      "bun",
      ["run", openScript, "--file", OUTPUT_PATH],
      { stdio: "inherit" },
    );
    if (r.status !== 0) {
      console.error("✘ open-postman.script.ts falló.");
      return r.status ?? 1;
    }
  }
  return 0;
}

process.exit(await main());
