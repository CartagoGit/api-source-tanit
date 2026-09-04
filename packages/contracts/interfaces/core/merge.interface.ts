/**
 * Fusión de endpoints para proyectos híbridos.
 *
 * Un proyecto híbrido es uno donde la detección encuentra **dos o más**
 * frameworks a la vez —un repo con un Express heredado y un OpenAPI
 * nuevo, un monolito PHP con documentación FastAPI a su lado—. Cada
 * scanner contribuye una pieza: uno tiene la ruta, otro el body, otro
 * el auth, otro la descripción. Antes el `dedupeSpecs` del pipeline se
 * quedaba con el primero y descartaba el resto, así que la colección
 * finalizaba con solo la información del scanner ganador y perdía todo
 * lo demás en silencio.
 *
 * Este contrato introduce la **fusión explícita**: dado N candidatos
 * para el mismo endpoint (identidad = method + uri normalizada), el
 * merger elige pieza a pieza cuál se queda y deja rastro de quién
 * aportó qué (`provenance`).
 *
 * No reemplaza al `dedupeSpecs` legacy: ese sigue siendo el primer corte
 * para identidades que NO colisionan (lo normal). El merger entra
 * cuando dos scanners SÍ declaran la misma operación y hay que
 * reconciliar.
 */
import type { IDetectedAuthScheme } from "./discovery.interface.js";
import type { IValidationSpec } from "./scanner.interface.js";
import type { IEndpointField } from "./postman.interface.js";

/**
 * Confianza por pieza — un número entre 0 y 1.
 *
 * Viene del scanner (no del merger): el merger es agnóstico, solo
 * compara. La tabla implícita la mantiene el servicio concreto que
 * conoce los frameworks (`EndpointMerger`); los demás consumidores
 * pueden pasarle su propio `confidenceFor` para mantenerlo portable.
 */
export type Confidence = number;

/**
 * De qué scanner vino cada pieza de un endpoint fusionado.
 *
 * `route` es obligatorio porque el endpoint tiene que existir por algo.
 * El resto son opcionales: si el scanner A solo aporta la ruta y
 * ningún body, `body` queda `undefined` y el merger no tiene nada que
 * comparar (lo que significa que el ganador de body lo decide la
 * otra pieza del puzzle, no la ausencia).
 *
 * `evidence` es el texto crudo que motivó la detección
 * (`detectAuthScheme` lo expone; los scanners lo rellenan). Va al
 * aviso del CLI: una detección automática que no se puede contrastar
 * es una que hay que creerse a ciegas.
 */
export interface IEndpointProvenance {
  /** Quién descubrió la ruta (method + uri). */
  readonly route: { framework: string; confidence: Confidence };
  /** Quién aportó el body / validación. */
  readonly body?: { framework: string; confidence: Confidence };
  /** Quién aportó el auth. */
  readonly auth?: { framework: string; evidence: string };
  /** Quién aportó la descripción. */
  readonly description?: { framework: string };
  /**
   * Frameworks que declararon este endpoint pero **perdieron** la
   * comparación pieza a pieza. Útil para la UI: «OpenAPI dijo esto,
   * Fastify lo confirmó, pero ganó Fastify porque su schema era más
   * detallado». Vacío en el caso de un solo candidato.
   */
  readonly contributors: ReadonlyArray<string>;
}

/**
 * Un endpoint fusionado, con su provenance por pieza.
 *
 * El merger opera sobre un grupo de candidatos y devuelve UNO de
 * estos. La pieza que sobrevive (body, auth, description) es la que
 * ganó la comparación; las demás se quedan solo en `provenance` para
 * no perder el rastro.
 *
 * `fields` es la unión restrictiva de los campos de todos los
 * candidatos: si A dice `required: true` y B dice `required: false`,
 * gana `true`. Si A dice `integer` y B dice `string`, gana `integer`
 * (porque `integer` rechaza strings, no al revés).
 *
 * `name` se preserva del candidato ganador — es parte de la
 * identidad (GraphQL/tRPC), no una pieza a fusionar.
 *
 * `confidence` es la media ponderada de las piezas, con los pesos
 * `route 0.4 / body 0.3 / auth 0.2 / description 0.1`. Cuando una
 * pieza falta, su peso se redistribuye proporcionalmente entre las
 * presentes — un endpoint solo de ruta no tiene por qué salir con
 * 0.6 de confianza por no tener body.
 */
export interface IMergedEndpoint {
  readonly method: string;
  readonly uri: string;
  /** Nombre del endpoint (preservado del ganador). */
  readonly name?: string;
  /** La pieza de mayor confianza cuando hay varias. */
  readonly body?: unknown;
  /** Campos declarados por algún scanner. */
  readonly fields?: ReadonlyArray<IValidationSpec | IEndpointField>;
  /** El auth de mayor confianza. */
  readonly authScheme?: IDetectedAuthScheme;
  /** La descripción más larga. */
  readonly description?: string;
  /** Provenance explícita por pieza. */
  readonly provenance: IEndpointProvenance;
  /** Confianza global del endpoint (0–1). */
  readonly confidence: Confidence;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers para que `IMergedEndpoint.fields` admita tanto los
// `IValidationSpec` agnósticos de los scanners como los `IEndpointField`
// que ya viajan en `EndpointSpec.fields` después del adapter.
// ─────────────────────────────────────────────────────────────────────

/**
 * Lo que el merger espera en `fields` por candidato: la unión de los
 * dos shapes existentes. El adapter (`parsed-route-to-spec.adapter.ts`)
 * convierte `IValidationSpec → IEndpointField` al producir el spec;
// el merger acepta ambos para que el pipeline no tenga que recordar
// a qué lado de la frontera está. Son estructuralmente compatibles
// en `fieldName`, `location`, `type`, `required`, `format`,
 * `enumValues`, `minimum`, `maximum`, `minLength`, `maxLength`.
 */

/**
 * Un candidato a endpoint: la contribución de UN scanner para UNA
 * identidad (method + uri).
 *
 * El merger agrupa por identidad y compara los candidatos de cada
 * grupo. Los campos opcionales son los que no todos los scanners
 * aportan: un regex-based solo tiene la ruta; OpenAPI tiene el body
 * y el auth; Fastify tiene el schema.
 *
 * `method`, `uri` y `name` son la **identidad** del candidato, no
 * piezas a fusionar: dos candidatos con misma identidad son
 * candidatos a fusionar. El merger los exige para poder producir un
 * `IMergedEndpoint` con identidad estable. `name` distingue el caso
 * GraphQL/tRPC donde hay **un** endpoint (`POST /graphql`) y lo que
 * diferencia una operación de otra es el nombre.
 */
export interface IEndpointMergeCandidate {
  readonly framework: string;
  /** Score del detector (0-1). Sirve como desempate. */
  readonly scannerScore: Confidence;
  /** Método HTTP (uppercased a la salida). */
  readonly method: string;
  /** URI normalizada Postman (`{{param}}`). */
  readonly uri: string;
  /** Nombre del endpoint (clave para GraphQL/tRPC). */
  readonly name?: string;
  readonly body?: unknown;
  readonly fields?: ReadonlyArray<IValidationSpec | IEndpointField>;
  readonly authScheme?: IDetectedAuthScheme;
  readonly description?: string;
  /**
   * Identidad del workspace / servicio al que pertenece este candidato.
   *
   * Audit 2ª revisión #3: en un monorepo con `apps/users-api` y
   * `apps/payments-api`, dos `GET /health` de workspaces distintos
   * no son la misma operación. El merger debe incluirlos en su
   * clave de identidad (vía `endpointKey`) para NO fusionarlos.
   *
   * Cadena vacía = proyecto plano (sin workspaces). Es el default
   * y mantiene la compatibilidad con callers no-monorepo.
   */
  readonly serviceId?: string;
}

/**
 * El merger: dado N detecciones del mismo endpoint, devuelve uno.
 *
 * Es una interfaz a propósito: el `EndpointMerger` por defecto vive
 * en `packages/core`, pero un proyecto podría querer uno que aplique
 * reglas distintas (p. ej. priorizar siempre OpenAPI sin mirar el
 * resto). Pasarlo por abstracción permite inyectarlo desde los
 * tests sin levantar el `EndpointMerger` real.
 *
 * `merge()` devuelve un `IMergeResult` que combina el endpoint
 * fusionado con los **conflictos** que el merger resolvió
 * (intersección vacía de enums, formatos incompatibles, etc.).
 * `IMergedEndpoint` solo lleva el resultado; los avisos viajan
 * separados porque en el pipeline se agregan al `IMergeOutcome.warnings`
 * que también recoge los conflictos de auth — mezclar los dos en el
 * `IMergedEndpoint` haría cada endpoint responsable de su propia
 * auditoría, que es justo lo contrario de un pipeline.
 */
export interface IEndpointMerger {
  merge(
    candidates: ReadonlyArray<IEndpointMergeCandidate>,
  ): IMergeResult;
}

/**
 * Salida de `IEndpointMerger.merge`: el endpoint fusionado y la lista
 * de conflictos que el merger **no pudo resolver por sí solo**.
 *
 * Cada conflicto es una línea legible apta para CLI/UI. El caller
 * decide dónde la mete (warnings del pipeline, log, popup). El merger
 * no la imprime: eso sería acoplar el dominio a `console.log`, que
 * ya mordió a los helpers de detección.
 */
export interface IMergeResult {
  readonly merged: IMergedEndpoint;
  /**
   * Conflictos resueltos con aviso: intersección vacía de enums,
   * formatos/patrones divergentes, type mismatch entre scanners, etc.
   * Vacío en el camino feliz.
   */
  readonly conflicts: ReadonlyArray<string>;
}

/**
 * Entrada plana del provenance por endpoint, para que
 * `IGenerationResult.provenance` no tenga que anidar objetos.
 *
 * Es lo que la UI / `summary` consume para enseñar «este endpoint
 * vino de Express con body de OpenAPI».
 */
export interface IEndpointProvenanceEntry {
  readonly method: string;
  readonly uri: string;
  readonly provenance: IEndpointProvenance;
  readonly confidence: Confidence;
}

/**
 * Pesos del confidence global.
 *
 * El total suma 1.0. Cuando una pieza falta, su peso se redistribuye
 * entre las presentes. Constantes para que el cálculo sea trazable
 * desde los tests.
 */
export const ENDPOINT_CONFIDENCE_WEIGHTS = {
  route: 0.4,
  body: 0.3,
  auth: 0.2,
  description: 0.1,
} as const;

/**
 * Lo que produce `mergeEndpoints` cuando agrupa candidatos por
 * identidad y los fusiona. Es el resultado a nivel de pipeline.
 */
export interface IMergeOutcome {
  /** Endpoints fusionados, en el orden en que aparecieron los grupos. */
  readonly specs: ReadonlyArray<IMergedEndpoint>;
  /** Provenance plana, indexable por `method + uri`. */
  readonly provenance: ReadonlyArray<IEndpointProvenanceEntry>;
  /** Avisos que el merger no pudo resolver por sí solo. */
  readonly warnings: ReadonlyArray<string>;
}

/** Opciones del merger a nivel de pipeline. */
export interface IMergeEndpointsOptions {
  /**
   * Tabla de confianza por framework. Útil para tests y para un
   * consumidor que quiera su propia política.
   */
  readonly frameworkConfidence?: Readonly<Record<string, Confidence>>;
}
