/**
 * per-service auth + baseUrl wiring — a00013 S4.
 *
 * El discriminante `IEndpointAuth` (`{ kind: "none" } | { kind: "scheme",
 * scheme: "bearer" | "apiKey" | "oauth2" }`) es exhaustivo por tipos:
 * TypeScript rechaza cualquier asignación que no encaje con una de las
 * dos ramas. Una conversión descuidada `{ kind: "scheme", scheme: "bearer" }
 * → { kind: "none" }` (lo que la primera auditoría del 2026-09-04
 * documentó como el "bug opuesto") se evita **por construcción** aquí:
 * los helpers se limitan a devolver los objetos que recibieron, sin
 * reescribir el `kind`. Si alguien añade un atajo que colapsa
 * ramas, el discriminante deja de proteger y esta capa pierde su
 * única línea de defensa.
 *
 * Por qué existe como módulo aparte del merger / pipeline:
 *  - merger-side ya tiene un `authFromAuthScheme` privado
 *    (`endpoint-merger.service.ts:347`) que convierte
 *    `IDetectedAuthScheme → IEndpointAuth`. Es lo inverso semántico de
 *    `authSchemeFromEndpointAuth` en `generation.pipeline.ts`. DRY
 *    entre las tres conversiones es trabajo de un slice posterior; en
 *    S4 solo necesitamos el path de per-service (que entra por
 *    `service.auth` y necesita `pickAuth`).
 *  - pipeline-side necesita un pequeño "adapter" `IDetectedAuthScheme
 *    → IEndpointAuth` para alimentar a `pickAuth` con un fallback
 *    "project-wide". Lo exportamos aquí (no como
 *    `authFromAuthScheme` para no chocar con el nombre del merger) y
 *    vive en este módulo porque quien prueba S4 quiere ver ambos
 *    sentidos en un solo sitio.
 *
 * Pure. No I/O. No `process.cwd()`. No muta nada.
 *
 * @see ./generation.pipeline.ts para el call site (`buildForService`).
 * @see ./group-by-service.helper.ts para la fuente del
 *   `IServiceDescriptor` que estos helpers reciben.
 * @see ../../contracts/interfaces/core/postman.interface.ts para la
 *   forma de `IEndpointAuth`.
 */

import type { IEndpointAuth } from "../../contracts/interfaces/core/postman.interface.js";
import type { IDetectedAuthScheme } from "../../contracts/interfaces/core/discovery.interface.js";
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";
import type { IServiceDescriptor } from "../../contracts/interfaces/core/service-graph.interface.js";

/**
 * Resuelve la auth de un servicio: override del descriptor si la trae
 * (lo que el grafo plantó), o fallback heredado del proyecto.
 *
 * El retorno es exhaustivo por discriminante: si `service.auth` es
 * `{ kind: "scheme", scheme: "bearer" }`, devuelve eso exactamente;
 * no lo convierte a `{ kind: "none" }` ni a `{ kind: "scheme",
 * scheme: "apiKey" }`. La función no sabe —ni necesita saber— qué
 * hacer con cada variante: el contrato es "el primer argumento gana
 * si está definido; si no, el segundo".
 *
 * Ambos argumentos son `IEndpointAuth | undefined`. Cuando los dos son
 * `undefined`, devuelve `undefined`. Eso significa "no hay señal de
 * auth para este servicio" y deja al pipeline decidir si el detector
 * por-espec debe correr o si el caller ya pasó otro mecanismo.
 *
 * @param service El descriptor del servicio. `service.auth` puede ser
 *   `undefined` (hereda del proyecto), `null` no es válido (`baseUrl`
 *   es `string | null` pero `auth` es estrictamente `IEndpointAuth |
 *   undefined`).
 * @param fallback La auth heredada del proyecto. Típicamente el
 *   resultado de `toIEndpointAuth(detectedFromSpecs)`. Puede ser
 *   `undefined` cuando el proyecto tampoco tiene señal.
 */
export function pickAuth(
  service: IServiceDescriptor,
  fallback: IEndpointAuth | undefined,
): IEndpointAuth | undefined {
  if (service.auth !== undefined) return service.auth;
  return fallback;
}

/**
 * Conversión exhaustiva `IDetectedAuthScheme` → `IEndpointAuth`, inversa
 * semántica de `authSchemeFromEndpointAuth` en
 * `generation.pipeline.ts`.
 *
 * Exportada por separado para que los tests de S4 cubran los cuatro
 * casos del discriminante (`none`, `bearer`, `apiKey`, `oauth2`)
 * sin tener que arrastrar un IDetectedAuthScheme de mentira por el
 * pipeline.
 *
 * El switch es exhaustivo por tipo: si se añade una variante a
 * `AuthSchemeType` sin mapearla aquí, TypeScript marca el switch como
 * no-exhaustivo (TS7030 con `noImplicitReturns`). Es el mismo patrón
 * que `authSchemeFromEndpointAuth` usa en dirección contraria.
 */
export function toIEndpointAuth(detected: IDetectedAuthScheme): IEndpointAuth {
  switch (detected.type) {
    case "bearer":
      return { kind: "scheme", scheme: "bearer" };
    case "apikey":
      return { kind: "scheme", scheme: "apiKey" };
    case "oauth2":
      return { kind: "scheme", scheme: "oauth2" };
    case "none":
      return { kind: "none" };
  }
}

/**
 * Aplica los overrides per-service a la `ProjectConfig` **sin mutar
 * el original**. Devuelve una copia superficial con:
 *   - `baseUrl`: el del servicio si lo declara y no es `null`,
 *     si no el del proyecto. Eso es lo que `inferCollectionVariables`
 *     y `buildCollection` consumen en `buildForService`.
 *   - `variables`: copia del array, con la entrada `baseUrl`
 *     sustituida por el valor efectivo para que la variable de
 *     colección (`{{baseUrl}}`) refleje el override per-service.
 *
 * Pure: no toca `config`. Una llamada por iteración del loop
 * multi-service en `buildFor` es independiente — la siguiente
 * iteración recibe el `discovery.config` original, sin baseUrl
 * contaminado por el servicio anterior (S4 acceptance #3: `buildForService`
 * no muta `config.baseUrl` entre iteraciones).
 *
 * `@see` `IProjectContext` para el contexto raíz. Si en el futuro
 * entran más overrides per-service (auth global, headers extra,
 * prefijo de URI, etc.), este helper es el sitio natural para
 * extenderlos.
 */
export function buildServiceConfig(
  config: ProjectConfig,
  service: IServiceDescriptor,
): ProjectConfig {
  const baseUrl = service.baseUrl ?? config.baseUrl;
  const variables = config.variables.map((v) =>
    v.key === "baseUrl" ? { ...v, value: baseUrl } : v,
  );
  return {
    ...config,
    baseUrl,
    variables,
  };
}
