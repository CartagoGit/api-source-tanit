/**
 * Qué esquema de autenticación usa la API, deducido de sus endpoints.
 *
 * La colección salía **siempre** con `auth: { type: "bearer" }`. Da
 * igual lo que hiciera la API: una que autentica con `X-API-Key` recibía
 * un bloque bearer con un `{{token}}` que nadie rellena nunca, y una que
 * no tiene autenticación **ninguna** también. Quien importa la colección
 * se encuentra con una configuración que no es la suya y no tiene forma
 * de saber si es que la herramienta lo detectó mal o es que su API va
 * así.
 *
 * Esto es del núcleo, así que no puede mirar middlewares de Laravel ni
 * decoradores de NestJS: deduce del **resultado** del escaneo, que es lo
 * único agnóstico que hay. Las señales, de más a menos fiable:
 *
 *   1. Una cabecera o query param con pinta de clave de API repetida en
 *      varios endpoints → API key.
 *   2. Un endpoint `/oauth/token` o `/oauth/authorize` → OAuth2.
 *   3. Un endpoint de login que devuelve un token → bearer.
 *   4. Nada de lo anterior → **ninguno**, y se dice.
 *
 * Cuando no hay señal, no se inventa: la colección sale sin bloque
 * `auth`, que es la respuesta honesta y además la que hace que Postman
 * no mande una cabecera `Authorization` vacía en cada petición.
 */
import type { EndpointSpec } from "../contracts/postman.interface.js";

/** Esquemas que se saben reconocer y escribir. */
export type AuthSchemeType = "bearer" | "apikey" | "oauth2" | "none";

/** Variable de entorno donde vive la clave de API. */
export const AUTH_API_KEY_VARIABLE = "apiKey";
/** Variables del flujo OAuth2. Postman las pide por nombre. */
export const AUTH_CLIENT_ID_VARIABLE = "clientId";
/** Secreto de cliente para el flujo OAuth2. Va vacío y como secreto. */
export const AUTH_CLIENT_SECRET_VARIABLE = "clientSecret";

/**
 * El esquema de autenticación deducido, con la señal que lo delató.
 *
 * La `evidence` no es adorno: una detección automática que no se puede
 * contrastar hay que creérsela a ciegas.
 */
export interface IDetectedAuthScheme {
  readonly type: AuthSchemeType;
  /** Nombre de la cabecera o del query param, solo para `apikey`. */
  readonly keyName?: string;
  /** Dónde viaja la clave, solo para `apikey`. */
  readonly keyIn?: "header" | "query";
  /** URL del endpoint de token, solo para `oauth2`. */
  readonly tokenUrl?: string;
  /** URL de autorización, solo para `oauth2`. */
  readonly authorizeUrl?: string;
  /**
   * Por qué se ha decidido eso.
   *
   * Va al aviso del CLI y a la descripción de la colección: una
   * detección automática que no se puede contrastar es una que hay que
   * creerse a ciegas.
   */
  readonly evidence: string;
}

/**
 * Cabeceras que son una clave de API.
 *
 * `Authorization` NO está: esa es el bearer, y confundirlas haría que
 * una API con login normal saliera configurada como API key.
 */
const API_KEY_HEADERS = new Set([
  "x-api-key",
  "api-key",
  "apikey",
  "x-apikey",
  "x-api-token",
  "x-auth-token",
  "x-access-token",
]);

/** Query params que son una clave de API. */
const API_KEY_QUERY = new Set(["api_key", "apikey", "api-key", "access_token", "token"]);

/** Rutas del flujo OAuth2, tal como las publica casi todo el mundo. */
const OAUTH_TOKEN_RE = /\/oauth2?\/token\/?$/i;
const OAUTH_AUTHORIZE_RE = /\/oauth2?\/authorize\/?$/i;

/**
 * Cuántos endpoints tienen que compartir una cabecera para que cuente
 * como el esquema de la API.
 *
 * Uno solo no basta: puede ser un endpoint suelto que hable con un
 * tercero. Con dos ya es una convención del proyecto.
 */
const MIN_ENDPOINTS_FOR_API_KEY = 2;

function countKeyUsage(
  specs: ReadonlyArray<EndpointSpec>,
): { header: Map<string, number>; query: Map<string, number> } {
  const header = new Map<string, number>();
  const query = new Map<string, number>();

  for (const spec of specs) {
    for (const h of spec.headers ?? []) {
      const key = h.key.toLowerCase();
      if (API_KEY_HEADERS.has(key)) header.set(h.key, (header.get(h.key) ?? 0) + 1);
    }
    for (const q of spec.query ?? []) {
      const key = q.key.toLowerCase();
      if (API_KEY_QUERY.has(key)) query.set(q.key, (query.get(q.key) ?? 0) + 1);
    }
  }
  return { header, query };
}

/** El nombre más repetido, y cuántas veces. */
function topEntry(counts: Map<string, number>): { name: string; count: number } | null {
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of counts) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}

/**
 * Deduce el esquema de autenticación de la API.
 *
 * `hasLoginFlow` lo pasa el pipeline: es si el proyecto expone un
 * endpoint de sesión que el flujo de auth ha reconocido y cableado.
 */
export function detectAuthScheme(
  specs: ReadonlyArray<EndpointSpec>,
  hasLoginFlow: boolean,
): IDetectedAuthScheme {
  // 1. Clave de API. Va primero porque es la señal más concreta: un
  //    nombre de cabecera concreto repetido en varios sitios.
  const { header, query } = countKeyUsage(specs);
  const topHeader = topEntry(header);
  const topQuery = topEntry(query);

  if (topHeader && topHeader.count >= MIN_ENDPOINTS_FOR_API_KEY) {
    return {
      type: "apikey",
      keyName: topHeader.name,
      keyIn: "header",
      evidence: `la cabecera \`${topHeader.name}\` aparece en ${topHeader.count} endpoints`,
    };
  }
  if (topQuery && topQuery.count >= MIN_ENDPOINTS_FOR_API_KEY) {
    return {
      type: "apikey",
      keyName: topQuery.name,
      keyIn: "query",
      evidence: `el parámetro \`${topQuery.name}\` aparece en ${topQuery.count} endpoints`,
    };
  }

  // 2. OAuth2: sus endpoints tienen rutas muy reconocibles.
  const tokenUrl = specs.find((s) => OAUTH_TOKEN_RE.test(s.uri))?.uri;
  const authorizeUrl = specs.find((s) => OAUTH_AUTHORIZE_RE.test(s.uri))?.uri;
  if (tokenUrl) {
    return {
      type: "oauth2",
      tokenUrl,
      ...(authorizeUrl ? { authorizeUrl } : {}),
      evidence: `hay un endpoint de token OAuth2 en \`${tokenUrl}\``,
    };
  }

  // 3. Bearer: hay login y devuelve un token que el flujo ya guarda.
  if (hasLoginFlow) {
    return {
      type: "bearer",
      evidence: "el proyecto expone un endpoint de login que devuelve un token",
    };
  }

  // 4. Nada. Y se dice, en vez de poner un bearer que no existe.
  return {
    type: "none",
    evidence: "no se ha encontrado ninguna señal de autenticación",
  };
}

/** El bloque `auth` de una colección Postman v2.1.0. */
export interface IPostmanAuth {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * Traduce el esquema detectado al bloque `auth` de Postman.
 *
 * Devuelve `null` para `none`: una colección **sin** bloque `auth` es
 * distinta de una con uno vacío. Con bloque, Postman manda una cabecera
 * `Authorization` con un valor sin resolver en cada petición, y la API
 * contesta 401 por un motivo que no tiene nada que ver con lo que se
 * estaba probando.
 */
export function toPostmanAuth(scheme: IDetectedAuthScheme): IPostmanAuth | null {
  switch (scheme.type) {
    case "bearer":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: "{{token}}", type: "string" }],
      };
    case "apikey":
      return {
        type: "apikey",
        apikey: [
          { key: "key", value: scheme.keyName ?? "X-API-Key", type: "string" },
          { key: "value", value: `{{${AUTH_API_KEY_VARIABLE}}}`, type: "string" },
          // Postman lo llama `in`, y acepta `header` o `query`.
          { key: "in", value: scheme.keyIn ?? "header", type: "string" },
        ],
      };
    case "oauth2":
      return {
        type: "oauth2",
        oauth2: [
          { key: "grant_type", value: "client_credentials", type: "string" },
          { key: "accessTokenUrl", value: `{{baseUrl}}${scheme.tokenUrl ?? ""}`, type: "string" },
          ...(scheme.authorizeUrl
            ? [{ key: "authUrl", value: `{{baseUrl}}${scheme.authorizeUrl}`, type: "string" }]
            : []),
          { key: "clientId", value: `{{${AUTH_CLIENT_ID_VARIABLE}}}`, type: "string" },
          { key: "clientSecret", value: `{{${AUTH_CLIENT_SECRET_VARIABLE}}}`, type: "string" },
          { key: "tokenName", value: "access_token", type: "string" },
          { key: "addTokenTo", value: "header", type: "string" },
        ],
      };
    case "none":
      return null;
  }
}

/**
 * Las variables de entorno que hace falta rellenar para ese esquema.
 *
 * Van vacías y marcadas como secreto: el valor lo pone quien usa la
 * colección, y no debe acabar en un fichero versionado.
 */
export function authVariablesFor(
  scheme: IDetectedAuthScheme,
): Array<{ key: string; value: string; type: string }> {
  switch (scheme.type) {
    case "apikey":
      return [{ key: AUTH_API_KEY_VARIABLE, value: "", type: "secret" }];
    case "oauth2":
      return [
        { key: AUTH_CLIENT_ID_VARIABLE, value: "", type: "secret" },
        { key: AUTH_CLIENT_SECRET_VARIABLE, value: "", type: "secret" },
      ];
    // El bearer ya las trae del flujo de login (`authUsername`,
    // `authPassword`, `token`), y `none` no necesita ninguna.
    case "bearer":
    case "none":
      return [];
  }
}
