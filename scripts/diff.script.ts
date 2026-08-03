/**
 * Compara las URIs declaradas en la colección Postman con las URIs reales
 * descubiertas en el código fuente. Imprime diff y sale con código distinto
 * de 0 si hay diferencias.
 *
 * Framework-agnostic: usa el `DiscoveryOrchestrator` para obtener el
 * "source" correcto. Si el orchestrator encuentra un match no-Laravel
 * (OpenAPI, Express, etc.), compara contra esas rutas en lugar de
 * `parseAllRoutes()` (Laravel).
 *
 * Uso:
 *   bun scripts/diff.script.ts
 *   bun run check
 */
import { readFile } from "node:fs/promises";
import { parseAllRoutes } from "../service/route-parser.service.js";
import {
  normalizeForComparison,
  stripApiPrefix,
} from "../helper/uri.helper.js";
import { walkCollection } from "../helper/postman.helper.js";
import { outputCollectionPath } from "../service/paths.service.js";
import { loadProject } from "../service/project-loader.service.js";
import type { PostmanCollection } from "../contract/postman.interface.js";
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

async function main(): Promise<number> {
  const { config } = await loadProject();
  const argv = process.argv.slice(2);
  const outputIdx = argv.indexOf("--output");
  const outputFlag = outputIdx !== -1 ? argv[outputIdx + 1] ?? null : null;
  const COLLECTION_PATH = outputFlag
    ? outputFlag
    : await outputCollectionPath(config.name);

  const orch = new DiscoveryOrchestrator(DEFAULT_REGISTRY);
  const { match, scanner } = await orch.detectProject(
    process.env.POSTMAN_PROJECT_ROOT ?? ".",
  );

  const sourceKeys = new Set<string>();
  const sourceMap = new Map<string, { method: string; uri: string }>();

  if (match && scanner && match.framework !== "laravel") {
    // Fuente: scanner del orchestrator (OpenAPI, etc.)
    const routes = await scanner.scan(match);
    for (const r of routes) {
      const key = `${r.method} ${normalizeForComparison(r.uri)}`;
      sourceKeys.add(key);
      sourceMap.set(key, { method: r.method, uri: r.uri });
    }
    console.log(`(source: ${match.framework} via orchestrator)`);
  } else {
    // Fuente: Laravel legacy
    const routes = await parseAllRoutes(config.filePrefixes);
    for (const r of routes) {
      const uri = stripApiPrefix(r.uri);
      const key = `${r.method} ${normalizeForComparison(uri)}`;
      sourceKeys.add(key);
      sourceMap.set(key, { method: r.method, uri });
    }
  }

  const raw = await readFile(COLLECTION_PATH, "utf8");
  const collection = JSON.parse(raw) as PostmanCollection;
  const collKeys = new Set<string>();
  const collMap = new Map<string, { method: string; uri: string }>();

  for (const r of walkCollection(collection)) {
    const key = `${r.method} ${normalizeForComparison(r.uri)}`;
    collKeys.add(key);
    collMap.set(key, { method: r.method, uri: r.uri });
  }

  const onlyInSource = [...sourceKeys]
    .filter((k) => !collKeys.has(k) && !k.endsWith("GET auth-test"))
    .sort();
  const onlyInColl = [...collKeys].filter((k) => !sourceKeys.has(k)).sort();

  console.log(`Routes en source:        ${sourceKeys.size}`);
  console.log(`Requests en colección:   ${collKeys.size}`);
  console.log();

  if (onlyInSource.length === 0 && onlyInColl.length === 0) {
    console.log("✔ Colección sincronizada con el código fuente.");
    return 0;
  }

  if (onlyInSource.length > 0) {
    console.log(`✘ Faltan en la colección (${onlyInSource.length}):`);
    for (const k of onlyInSource) {
      const ep = sourceMap.get(k)!;
      console.log(`    ${ep.method.padEnd(6)} /${ep.uri}`);
    }
    console.log();
  }
  if (onlyInColl.length > 0) {
    console.log(`✘ Sobran en la colección (${onlyInColl.length}):`);
    for (const k of onlyInColl) {
      const ep = collMap.get(k)!;
      console.log(`    ${ep.method.padEnd(6)} /${ep.uri}`);
    }
  }
  return 1;
}

process.exit(await main());
