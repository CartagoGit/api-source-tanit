/**
 * What authentication scheme the API uses, inferred from its endpoints.
 *
 * The collection **always** used to come out with `auth: { type: "bearer" }`. It
 * did not matter what the API did: one authenticating with `X-API-Key` received
 * a bearer block with a `{{token}}` nobody ever filled in, and one with
 * **no** authentication did too. Whoever imports the collection finds a
 * configuration that is not theirs and cannot tell whether the tool detected
 * it incorrectly or their API is actually like that.
 *
 * This is core, so it cannot inspect Laravel middleware or NestJS decorators:
 * it infers from the **result** of the scan, which is the only agnostic
 * information available. The signals, from most to least reliable:
 *
 *   1. A header or query parameter that looks like an API key and is repeated
 *      across several endpoints → API key.
 *   2. An `/oauth/token` or `/oauth/authorize` endpoint → OAuth2.
 *   3. A login endpoint that returns a token → bearer.
 *   4. None of the above → **none**, and it is stated.
 *
 * When there is no signal, it is not invented: the collection is emitted
 * without an `auth` block, which is the honest answer and also prevents
 * Postman from sending an empty `Authorization` header on every request.
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { IDetectedAuthScheme, IPostmanAuth } from "../../contracts/interfaces/core/discovery.interface.js";
import { AUTH_API_KEY_VARIABLE, AUTH_CLIENT_ID_VARIABLE, AUTH_CLIENT_SECRET_VARIABLE } from "../../contracts/constants/core/auth.constant.js";

/**
 * Headers that are an API key.
 *
 * `Authorization` is not included: that is bearer, and confusing them would
 * make an API with normal login appear configured as an API key.
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

/** Query parameters that are an API key. */
const API_KEY_QUERY = new Set(["api_key", "apikey", "api-key", "access_token", "token"]);

/** Routes in the OAuth2 flow, as published by most systems. */
const OAUTH_TOKEN_RE = /\/oauth2?\/token\/?$/i;
const OAUTH_AUTHORIZE_RE = /\/oauth2?\/authorize\/?$/i;

/**
 * How many endpoints must share a header for it to count as the API's
 * authentication scheme.
 *
 * One is not enough: it may be an isolated endpoint talking to a third party.
 * With two, it is already a project convention.
 */
const MIN_ENDPOINTS_FOR_API_KEY = 2;

/**
 * Counts how many times each header or query parameter that looks like an API
 * key appears.
 *
 * It accumulates under the **canonical** key (lowercase) so `X-API-Key` and
 * `x-api-key` on different endpoints count as 2, not as two entries of 1
 * each that never reach the threshold.
 *
 * `headerDisplay` / `queryDisplay` keep, for each canonical key, the first
 * original name seen: that is the one shown to the user and used in the
 * Postman `auth.key` block.
 */
function countKeyUsage(specs: ReadonlyArray<EndpointSpec>): {
  header: Map<string, number>;
  headerDisplay: Map<string, string>;
  query: Map<string, number>;
  queryDisplay: Map<string, string>;
} {
  const header = new Map<string, number>();
  const headerDisplay = new Map<string, string>();
  const query = new Map<string, number>();
  const queryDisplay = new Map<string, string>();

  for (const spec of specs) {
    for (const h of spec.headers ?? []) {
      const key = h.key.toLowerCase();
      if (API_KEY_HEADERS.has(key)) {
        header.set(key, (header.get(key) ?? 0) + 1);
        if (!headerDisplay.has(key)) headerDisplay.set(key, h.key);
      }
    }
    for (const q of spec.query ?? []) {
      const key = q.key.toLowerCase();
      if (API_KEY_QUERY.has(key)) {
        query.set(key, (query.get(key) ?? 0) + 1);
        if (!queryDisplay.has(key)) queryDisplay.set(key, q.key);
      }
    }
  }
  return { header, headerDisplay, query, queryDisplay };
}

/** The most frequent name, and how many times it appears. */
function topEntry(counts: Map<string, number>): { name: string; count: number } | null {
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of counts) {
    if (!best || count > best.count) best = { name, count };
  }
  return best;
}

/**
 * Infers the API's authentication scheme.
 *
 * `hasLoginFlow` is passed by the pipeline: it is whether the project exposes
 * a session endpoint that the auth flow has recognized and wired in.
 */
export function detectAuthScheme(
  specs: ReadonlyArray<EndpointSpec>,
  hasLoginFlow: boolean,
): IDetectedAuthScheme {
  // 1. API key. It comes first because it is the most concrete signal: a
  //    specific header name repeated in several places.
  const { header, headerDisplay, query, queryDisplay } = countKeyUsage(specs);
  const topHeader = topEntry(header);
  const topQuery = topEntry(query);

  if (topHeader && topHeader.count >= MIN_ENDPOINTS_FOR_API_KEY) {
    const displayName = headerDisplay.get(topHeader.name) ?? topHeader.name;
    return {
      type: "apikey",
      keyName: displayName,
      keyIn: "header",
      evidence: `la cabecera \`${displayName}\` aparece en ${topHeader.count} endpoints`,
    };
  }
  if (topQuery && topQuery.count >= MIN_ENDPOINTS_FOR_API_KEY) {
    const displayName = queryDisplay.get(topQuery.name) ?? topQuery.name;
    return {
      type: "apikey",
      keyName: displayName,
      keyIn: "query",
      evidence: `el parámetro \`${displayName}\` aparece en ${topQuery.count} endpoints`,
    };
  }

  // 2. OAuth2: its endpoints have very recognizable paths.
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

  // 3. Bearer: there is login and it returns a token that the flow already stores.
  if (hasLoginFlow) {
    return {
      type: "bearer",
      evidence: "el proyecto expone un endpoint de login que devuelve un token",
    };
  }

  // 4. None. It is stated instead of adding a bearer that does not exist.
  return {
    type: "none",
    evidence: "no se ha encontrado ninguna señal de autenticación",
  };
}

/**
 * Translates the detected scheme to the Postman `auth` block.
 *
 * Returns `null` for `none`: a collection **without** an `auth` block is
 * different from one with an empty block. With a block, Postman sends an
 * `Authorization` header with an unresolved value on every request, and the
 * API returns 401 for a reason unrelated to what was being tested.
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
 * Environment variables that need to be filled in for this scheme.
 *
 * They are empty and marked as secrets: the person using the collection
 * supplies the value, and it must not end up in a versioned file.
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
    // Bearer already gets them from the login flow (`authUsername`,
    // `authPassword`, `token`), and `none` needs none.
    case "bearer":
    case "none":
      return [];
  }
}
