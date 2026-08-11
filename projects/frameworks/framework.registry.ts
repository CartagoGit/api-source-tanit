/**
 * Registry compartido de scanners para `DiscoveryOrchestrator`.
 *
 * Antes cada script (`diff.script.ts`, `generate.script.ts`,
 * `scan.scanner.script.ts`) declaraba su propio `DEFAULT_REGISTRY`.
 * Ahora todos importan de aquí. Es la única fuente de verdad sobre
 * qué frameworks soporta el paquete y en qué orden de prioridad.
 *
 * Orden de los detectores = orden de prioridad. Si dos `detect()`
 * empatan en score, gana el que aparezca primero en esta lista.
 */
import { DiscoveryOrchestrator } from "../core/discovery/discovery.orchestrator";
import {
  GraphQlProjectScanner,
  GraphQlRouteScanner,
} from "./scanners/graphql.scanner";
import { TrpcProjectScanner, TrpcRouteScanner } from "./scanners/trpc.scanner";
import { LaravelProjectScanner, LaravelRouteScanner, LaravelFormRequestValidationProvider } from "./laravel/laravel.scanner";
import { OpenApiProjectScanner, OpenApiRouteScanner, OpenApiValidationProvider } from "./scanners/openapi.scanner";
import {
  ExpressProjectScanner,
  ExpressRouteScanner,
  ExpressZodValidationProvider,
} from "./scanners/express.scanner";
import {
  FastApiProjectScanner,
  FastApiRouteScanner,
  FastApiPydanticValidationProvider,
} from "./scanners/fastapi.scanner";
import {
  SymfonyProjectScanner,
  SymfonyRouteScanner,
  SymfonyAttributesValidationProvider,
} from "./scanners/symfony.scanner";
import {
  NestJsProjectScanner,
  NestJsRouteScanner,
  NestJsClassValidatorProvider,
} from "./scanners/nestjs.scanner";
import {
  DjangoProjectScanner,
  DjangoRouteScanner,
  DjangoSerializerProvider,
} from "./scanners/django.scanner";
import {
  FlaskProjectScanner,
  FlaskRouteScanner,
  FlaskValidationProvider,
} from "./scanners/flask.scanner";
import {
  NextJsProjectScanner,
  NextJsRouteScanner,
  NextJsZodProvider,
} from "./scanners/nextjs.scanner";
import {
  GinProjectScanner,
  GinRouteScanner,
  GinBindingProvider,
} from "./scanners/gin.scanner";
import {
  SpringBootProjectScanner,
  SpringBootRouteScanner,
  SpringBootBeanValidationProvider,
} from "./scanners/springboot.scanner";
import {
  AspNetProjectScanner,
  AspNetRouteScanner,
  AspNetDataAnnotationsProvider,
} from "./scanners/aspnet.scanner";
import type { DiscoveryRegistry } from "../contracts/interfaces/core/discovery.interface";
import {
  FastifyProjectScanner,
  FastifyRouteScanner,
  FastifySchemaProvider,
} from "./scanners/fastify.scanner";
import {
  HonoProjectScanner,
  HonoRouteScanner,
  HonoZodValidatorProvider,
} from "./scanners/hono.scanner";
import {
  FiberProjectScanner,
  FiberRouteScanner,
  FiberValidateTagProvider,
} from "./scanners/fiber.scanner";
import type { IScannerBundle } from "../contracts/interfaces/frameworks/scanners.interface.js";
import {
  RustProjectScanner,
  RustRouteScanner,
  RustValidatorProvider,
} from "./scanners/rust.scanner";
import {
  RailsProjectScanner,
  RailsRouteScanner,
} from "./scanners/rails.scanner";
import {
  PhoenixProjectScanner,
  PhoenixRouteScanner,
} from "./scanners/phoenix.scanner";
import { KtorProjectScanner, KtorRouteScanner } from "./scanners/ktor.scanner";

import type {
  FrameworkId,
} from "../contracts/interfaces/core/scanner.interface";

/** Registry canónico con los 12 frameworks soportados. */
/**
 * El scanner de rutas de Fastify y su provider comparten instancia a
 * propósito: el provider lee el mapa de esquemas que el scanner rellena
 * al recorrer los ficheros. Dos instancias distintas dejarían al
 * provider sin nada que resolver.
 */
const fastifyRouteScanner = new FastifyRouteScanner();
/** Igual que Fastify: el provider lee lo que el scanner recogió. */
const honoRouteScanner = new HonoRouteScanner();
const fiberRouteScanner = new FiberRouteScanner();
const rustRouteScanner = new RustRouteScanner();

export const DEFAULT_REGISTRY: DiscoveryRegistry = {
  detectors: [
    new GraphQlProjectScanner(),
    new TrpcProjectScanner(),
    new PhoenixProjectScanner(),
    new KtorProjectScanner(),
    new RailsProjectScanner(),
    new RustProjectScanner(),
    new FiberProjectScanner(),
    new HonoProjectScanner(),
    new FastifyProjectScanner(),
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
    new GraphQlRouteScanner(),
    new TrpcRouteScanner(),
    new PhoenixRouteScanner(),
    new KtorRouteScanner(),
    new RailsRouteScanner(),
    rustRouteScanner,
    fiberRouteScanner,
    honoRouteScanner,
    fastifyRouteScanner,
    new LaravelRouteScanner(),
    new OpenApiRouteScanner(),
    new FastApiRouteScanner(),
    new SymfonyRouteScanner(),
    new NestJsRouteScanner(),
    new DjangoRouteScanner(),
    new SpringBootRouteScanner(),
    new AspNetRouteScanner(),
    new FlaskRouteScanner(),
    new NextJsRouteScanner(),
    new GinRouteScanner(),
    new ExpressRouteScanner(),
  ],
  validationProviders: [
    new RustValidatorProvider(rustRouteScanner),
    new FiberValidateTagProvider(fiberRouteScanner),
    new HonoZodValidatorProvider(honoRouteScanner),
    new FastifySchemaProvider(fastifyRouteScanner),
    new LaravelFormRequestValidationProvider(),
    new OpenApiValidationProvider(),
    new FastApiPydanticValidationProvider(),
    new SymfonyAttributesValidationProvider(),
    new NestJsClassValidatorProvider(),
    new DjangoSerializerProvider(),
    new SpringBootBeanValidationProvider(),
    new AspNetDataAnnotationsProvider(),
    new FlaskValidationProvider(),
    new NextJsZodProvider(),
    new GinBindingProvider(),
    new ExpressZodValidationProvider(),
  ],
};

/** Helper que devuelve un `DiscoveryOrchestrator` con el registry canónico. */
export function defaultOrchestrator(): DiscoveryOrchestrator {
  return new DiscoveryOrchestrator(DEFAULT_REGISTRY);
}

/**
 * Los IDs que este registro reconoce de verdad.
 *
 * No es el catálogo — el catálogo es `FRAMEWORK_IDS`, en contratos, y
 * esto es **lo que el registro cumple**. La dirección importa: derivar
 * la lista de nombres del registro obligaba a arrastrar los veintiún
 * scanners para leer veintiún strings, que es justo lo que hacía el
 * plugin MCP para declarar un `z.enum`.
 *
 * Se conserva porque hay un test que compara las dos y falla si sobra o
 * falta una. Una lista paralela no es peligrosa; una lista paralela que
 * nadie compara sí — este repositorio ya lo pagó con
 * `NON_LARAVEL_FRAMEWORKS`, que enumeraba once de doce frameworks y
 * mandaba a Laravel por un camino distinto sin decirlo.
 */
export function registeredFrameworkIds(): ReadonlyArray<FrameworkId> {
  return DEFAULT_REGISTRY.detectors.map((d) => d.framework);
}

/**
 * Devuelve los colaboradores registrados para un framework.
 *
 * Sustituye a la carga por reflexión sobre nombres de clase: adivinar
 * `FastapiProjectScanner` a partir del id `fastapi` fallaba en la mitad
 * de los frameworks (`FastApi`, `NestJs`, `NextJs`, `SpringBoot`,
 * `AspNet`, `OpenApi`) sin que nada lo detectase en compilación.
 */
export function scannerBundleFor(framework: FrameworkId): IScannerBundle | null {
  const projectScanner = DEFAULT_REGISTRY.detectors.find((d) => d.framework === framework);
  const routeScanner = DEFAULT_REGISTRY.routeScanners.find((r) => r.framework === framework);
  if (!projectScanner || !routeScanner) return null;
  return {
    projectScanner,
    routeScanner,
    validationProvider:
      DEFAULT_REGISTRY.validationProviders.find((v) => v.framework === framework) ?? null,
  };
}
