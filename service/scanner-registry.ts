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
import { DiscoveryOrchestrator } from "./discovery.orchestrator";
import {
  LaravelProjectScanner,
  LaravelScanner,
  LaravelFormRequestValidationProvider,
} from "./scanners/laravel.scanner";
import {
  OpenApiProjectScanner,
  OpenApiScanner,
  OpenApiValidationProvider,
} from "./scanners/openapi.scanner";
import {
  ExpressProjectScanner,
  ExpressScanner,
  ExpressZodValidationProvider,
} from "./scanners/express.scanner";
import {
  FastApiProjectScanner,
  FastApiScanner,
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
  FlaskPydanticProvider,
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

import type { DiscoveryRegistry } from "./discovery.orchestrator";
import type {
  FrameworkId,
  IProjectScanner,
  IRouteScanner,
  IValidationSpecProvider,
} from "../contract/scanner.interface";

/** Registry canónico con los 12 frameworks soportados. */
export const DEFAULT_REGISTRY: DiscoveryRegistry = {
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

/** Helper que devuelve un `DiscoveryOrchestrator` con el registry canónico. */
export function defaultOrchestrator(): DiscoveryOrchestrator {
  return new DiscoveryOrchestrator(DEFAULT_REGISTRY);
}

/**
 * IDs de los frameworks soportados, derivados del propio registry.
 *
 * Cualquier consumidor que necesite iterar frameworks (el tool `test`,
 * los smoke runners, la documentación generada) debe leer esta lista en
 * lugar de mantener su propia copia: una lista paralela se desincroniza
 * en cuanto se añade un scanner.
 */
export const SUPPORTED_FRAMEWORKS: ReadonlyArray<FrameworkId> =
  DEFAULT_REGISTRY.detectors.map((d) => d.framework);

/** Trío de colaboradores de un framework, o `null` si no está soportado. */
export interface IScannerBundle {
  readonly projectScanner: IProjectScanner;
  readonly routeScanner: IRouteScanner;
  readonly validationProvider: IValidationSpecProvider | null;
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
