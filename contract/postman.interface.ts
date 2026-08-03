/**
 * Tipos del schema Postman v2.1.0.
 * Documentación oficial: https://schema.getpostman.com/json/collection/v2.1.0/collection.json
 */

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

export interface PostmanHeader {
  key: string;
  value: string;
  type?: string;
}

export interface PostmanBody {
  mode: "raw" | "formdata" | "urlencoded" | "file";
  raw?: string;
  options?: { raw?: { language: string } };
}

export interface PostmanRequest {
  method: string;
  header: PostmanHeader[];
  url: PostmanUrl;
  description?: string;
  body?: PostmanBody;
}

export interface PostmanEvent {
  listen: "test" | "prerequest";
  script: { type: string; exec: string[] };
}

export interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  description?: string;
  event?: PostmanEvent[];
}

export interface PostmanVariable {
  key: string;
  value: string;
  type?: string;
}

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
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
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
   * Ruta relativa al proyecto del FormRequest asociado
   * (p. ej. `app/Http/Requests/Usuarios/NuevoUsuarioRequest.php`).
   * Si está, el enricher lo usa directamente en lugar de heurísticas.
   */
  formRequest?: string;
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