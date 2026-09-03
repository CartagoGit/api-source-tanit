/**
 * Tipos del schema Postman v2.1.0.
 * Documentación oficial: https://schema.getpostman.com/json/collection/v2.1.0/collection.json
 */
import type { ISchemaGraph } from "./schema.interface.js";
import type { IValidationSource } from "./validation-source.interface.js";

export interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query?: Array<{
    key: string;
    value: string;
    description?: string;
    disabled?: boolean;
  }>;
}

/** Una cabecera HTTP tal como la guarda Postman. */
export interface PostmanHeader {
  key: string;
  value: string;
  type?: string;
}

/**
 * El cuerpo de una petición.
 *
 * Este proyecto solo emite `raw` con JSON: es lo que se puede derivar de
 * unas reglas de validación. Los otros modos existen en el formato y se
 * declaran para poder leer una colección ajena sin perderlos.
 */
export interface PostmanBody {
  mode: "raw" | "formdata" | "urlencoded" | "file";
  raw?: string;
  options?: { raw?: { language: string } };
}

/**
 * La petición de un item: qué se manda y a dónde.
 *
 * `method` es `string` y no la unión de verbos porque aquí también se
 * leen colecciones que no ha escrito esta herramienta.
 */
export interface PostmanRequest {
  method: string;
  header: PostmanHeader[];
  url: PostmanUrl;
  description?: string;
  body?: PostmanBody;
}

/**
 * Un script que Postman ejecuta alrededor de la petición.
 *
 * `prerequest` corre antes de mandarla; `test`, después de recibir la
 * respuesta. `exec` es el script partido en líneas, que es como lo
 * guarda el formato.
 */
export interface PostmanEvent {
  listen: "test" | "prerequest";
  script: { type: string; exec: string[] };
}

/**
 * Un nodo del árbol de la colección.
 *
 * Es carpeta **o** petición según qué campo traiga: con `item` es
 * carpeta y con `request` es petición. El formato no los separa en dos
 * tipos, así que aquí tampoco.
 */
export interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  description?: string;
  event?: PostmanEvent[];
}

/**
 * Una variable de colección o de entorno.
 *
 * `type: "secret"` hace que Postman la oculte en la interfaz: es lo que
 * llevan el token y las credenciales.
 */
export interface PostmanVariable {
  key: string;
  value: string;
  type?: string;
}

/**
 * Una colección Postman v2.1.0 completa.
 *
 * El `_postman_id` de `info` es lo que decide si reimportar **actualiza**
 * la colección o crea otra al lado, así que se deriva del proyecto y no
 * se sortea (p00014).
 */
export interface PostmanCollection {
  info: {
    name: string;
    description: string;
    schema: string;
    _postman_id?: string;
  };
  auth?: {
    type: string;
    bearer?: Array<{ key: string; value: string; type?: string }>;
  };
  variable: PostmanVariable[];
  item: PostmanItem[];
}

/** Endpoint declarado en build-collection.service.ts (catálogo). */
export interface EndpointSpec {
  name: string;
  /**
   * Método HTTP.
   *
   * `HEAD`, `OPTIONS` y `TRACE` entran aquí porque los scanners los
   * detectan y Postman los soporta. Sin ellos, un `method: ["GET",
   * "HEAD"]` de Fastify, un `app.Options()` de Fiber o un `trace:` en
   * un path de OpenAPI se escaneaban bien y desaparecían en el adapter
   * sin decir nada.
   *
   * La lista runtime vive en `SUPPORTED_METHODS` (mismo paquete) y es
   * la que el adapter consulta para decidir qué deja pasar: tener las
   * dos en sync es la garantía de que añadir un verbo aquí surte
   * efecto.
   */
  method:
    | "GET"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE"
    | "HEAD"
    | "OPTIONS"
    | "TRACE";
  /** URI relativa sin el prefijo `/api`. Empieza con `/`. */
  uri: string;
  description?: string;
  /** Objeto JSON literal para el body. Se serializa a JSON pretty. */
  body?: unknown;
  /** Query params opcionales. */
  query?: Array<{ key: string; value: string; description?: string }>;
  /**
   * Headers personalizados opcionales (ej. `X-API-Key`).
   * Los headers `Authorization` y `Accept` se añaden automáticamente
   * en collection-builder; este array es ADICIONAL.
   */
  headers?: Array<{
    key: string;
    value: string;
    description?: string;
  }>;
  /**
   * Carpeta explícita. Si está, se usa como nombre del folder en lugar
   * del calculado automáticamente por `topGroupFor(uri)`. Útil para
   * agrupar endpoints que viven en prefijos distintos bajo una misma
   * carpeta lógica (p. ej. "ERP" contiene `erp/*` y `tol/tecdoc/*`).
   */
  folder?: string;
  /**
   * Override por operación del esquema de auth de la colección.
   *
   * Antes el builder inyectaba `Authorization: Bearer {{token}}` en
   * **cada** request cuando el esquema global era bearer —también
   * en `/auth/login`, que es el endpoint que precisamente emite el
   * token. Resultado: un 401 al primer Send, con la culpa apuntando a
   * una request que en realidad es lo que rellena la variable.
   *
   * Con este campo, un endpoint puede declararse público
   * (`auth: { kind: "none" }`) y el builder omite la cabecera
   * `Authorization` para él, sin tocar el esquema global. Pensado
   * para login, /health, /register, /forgot-password y similares.
   *
   * El discriminador `scheme` se reserva para overrides por esquema
   * futuros (apiKey, oauth2) — hoy el único caso útil es `none`.
   *
   * S3.b (a00012). La regla vive en
   * `packages/core/domain/collection-builder.service.ts` →
   * `defaultHeaders()`.
   */
  auth?: IEndpointAuth;
  /**
   * Ruta relativa al proyecto del FormRequest asociado
   * (p. ej. `app/Http/Requests/Usuarios/NuevoUsuarioRequest.php`).
   * Si está, el enricher lo usa directamente en lugar de heurísticas.
   *
   * @deprecated Usar `validationSource`. El campo string era una
   * mezcla de **proveedor** y **path** del artefacto — el adapter lo
   * escribía como `"laravel:app/Http/Requests/..."` aunque el nombre
   * del framework era el dato de routing, no una propiedad del
   * endpoint. Se conserva por compat con `enrichCatalogWithFormRequests`
   * y con los tests que aún lo leen; los nuevos proveedores declaran
   * su contrato en `IValidationSource`. S5 (a00012).
   */
  formRequest?: string;
  /**
   * Fuente agnóstica de las reglas de validación del endpoint.
   *
   * Si está presente, el adapter ya ha decidido QUÉ enricher (no cuál
   * framework) se encarga de procesarlo. El registry
   * (`packages/core/validation/validation-enricher.service.ts`)
   * despacha por `provider` y los frameworks que aún no tienen
   * enricher pasan de largo.
   *
   * El adapter (S5) sólo lo asigna cuando el provider resuelto es
   * `"laravel-form-request"`. Cualquier otro caso —Express, FastAPI,
   * OpenAPI— deja el campo `undefined`, y eso es lo que cierra S5:
   * `enrichCatalogWithFormRequests` ya no se llama para proyectos no
   * Laravel. Migrar el resto de frameworks es follow-up de a00010 S6
   * y siguientes.
   *
   * Se deja mutable (sin `readonly`) para encajar con el patrón del
   * adapter: `parsed-route-to-spec.adapter.ts` construye el spec con
   * los campos básicos y luego asigna el resto uno a uno. Los campos
   * posteriores (`auth`, `schemaGraph`) son `readonly` porque los
   * rellena el `collection-builder`, no el adapter.
   */
  validationSource?: IValidationSource;
  /**
   * Reglas de validación resueltas para este endpoint.
   *
   * De aquí sale el `body` de ejemplo, pero también la tabla de campos
   * que va en la descripción de la request: el ejemplo enseña **un**
   * valor válido, y esto dice cuáles son válidos. Un `age: 30` no
   * cuenta que el máximo son 120.
   *
   * Se guarda aparte del `body` porque un ejemplo no se puede
   * des-ejemplificar: del JSON ya construido no hay forma de recuperar
   * qué era obligatorio ni qué formato tenía cada campo.
   *
   * Se queda como fuente de verdad **plana** mientras los 21 scanners
   * no se hayan migrado al grafo (a00010 S6 introduce el grafo y deja
   * esta lista como fallback); ver `schemaGraph`.
   */
  fields?: ReadonlyArray<IEndpointField>;
  /**
   * Grafo de tipos del endpoint, si el scanner lo emite.
   *
   * Cuando está, los exportadores que saben consumirlo (OpenAPI por
   * ahora) prefieren el grafo sobre `fields`: el grafo expresa
   * objetos anidados, arrays de objetos, uniones (`oneOf`/`anyOf`),
   * referencias cruzadas y recursión, que la lista plana no puede
   * representar — el OpenAPI exporter emitía `items: string` cuando el
   * items real era un objeto, por ejemplo.
   *
   * `root` apunta al nodo que describe el body de la request. Los
   * demás nodos son accesibles por id desde el mapa `nodes`.
   *
   * Es opcional a propósito: los 21 scanners actuales siguen emitiendo
   * solo `fields`. Migrar cada uno queda como follow-up de a00010 S7
   * (AST TypeScript) y siguientes. Mientras tanto, los exportadores
   * que aún no consumen el grafo pueden llamar a `flatten-helper` para
   * reconstruir la lista plana.
   *
   * @see ./schema.interface.ts
   */
  schemaGraph?: ISchemaGraph;
}

/**
 * Override por operación del esquema de auth de la colección.
 *
 * Es un union discriminado: el `kind` marca el caso. Solo se admite
 * `none` hoy —la cabecera `Authorization` no se inyecta—, pero la
 * forma está dimensionada para añadir `scheme: "bearer"|"apiKey"|...`
 * sin tener que cambiar el call site (a00012 S3.b).
 */
export type IEndpointAuth =
  | { readonly kind: "none" }
  | { readonly kind: "scheme"; readonly scheme: "bearer" | "apiKey" | "oauth2" };

/** Una regla de validación, tal como se documenta en la colección. */
export interface IEndpointField {
  readonly fieldName: string;
  readonly location: "body" | "query" | "path" | "header" | "cookie";
  readonly type: string;
  readonly required: boolean;
  readonly format?: string | undefined;
  readonly enumValues?: ReadonlyArray<string> | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
}

/** Ruta descubierta en routes/*.php. */
export interface DiscoveredRoute {
  method: string;
  uri: string;
}

/**
 * Environment Postman v2.1.0.
 * https://learning.postman.com/docs/sending-requests/managing-environments/
 */
export interface PostmanEnvironment {
  id: string;
  name: string;
  values: Array<{
    key: string;
    value: string;
    enabled: boolean;
    type?: "default" | "secret";
    description?: string;
  }>;
  _postman_id?: string;
  scope?: "environment";
  /** Color en formato #RRGGBB para distinguir visualmente en Postman. */
  color?: string;
}