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
