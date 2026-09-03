/**
 * Flujo de autenticación de la colección.
 *
 * El objetivo es que, tras importar, el usuario rellene sus credenciales
 * UNA vez en el environment, lance Login, y todo lo demás funcione sin
 * volver a tocar el token.
 *
 * Antes existía `attachLoginAutoToken`, que en la práctica no se
 * activaba nunca (medido: 0 de 11 proyectos de ejemplo) por dos motivos:
 *
 *   1. Exigía un `tokenResponsePath` configurado a mano, y salía por la
 *      puerta de atrás con `if (!tokenPath) return;`.
 *   2. Buscaba el endpoint de login comparando el NOMBRE del item contra
 *      ["login", "authenticate", …], mientras los nombres que genera el
 *      builder son "Crear Login", "/POST auth/login", "/api_login"…
 *
 * Aquí el login se detecta por método + URI, que es estable entre
 * frameworks, y el script prueba en ejecución los caminos habituales de
 * la respuesta en lugar de exigir que se declaren.
 */
import type {
  PostmanCollection,
  PostmanItem,
} from "../../contracts/interfaces/core/postman.interface.js";
import type { IAuthFlow } from "../../contracts/interfaces/core/discovery.interface.js";
import type { IApplyAuthFlowOptions } from "../../contracts/interfaces/core/domain.interface.js";
import { AUTH_PASSWORD_VARIABLE, AUTH_TOKEN_VARIABLE, AUTH_USERNAME_VARIABLE } from "../../contracts/constants/core/auth.constant.js";

/** Sufijos de URI que identifican cada paso del ciclo. */
const LOGIN_URI_PATTERNS = [
  /\/login\/?$/i,
  /\/signin\/?$/i,
  /\/sign-in\/?$/i,
  /\/authenticate\/?$/i,
  /\/auth\/token\/?$/i,
  /\/oauth\/token\/?$/i,
  /\/sessions?\/?$/i,
];

/**
 * Si el proyecto expone un endpoint de sesión, mirando los specs.
 *
 * `detectAuthFlow` responde a lo mismo pero sobre la **colección ya
 * construida**, y hay quien necesita saberlo antes de construirla: el
 * esquema de autenticación decide qué cabeceras lleva cada petición, así
 * que no se puede resolver después.
 *
 * Comparte los patrones con `detectAuthFlow` a propósito. Dos listas de
 * rutas de login se desincronizan, y entonces la colección diría que hay
 * bearer mientras el flujo no cablea ningún token, o al revés.
 */
export function hasLoginEndpoint(
  specs: ReadonlyArray<{ method: string; uri: string }>,
): boolean {
  return specs.some(
    (s) =>
      s.method.toUpperCase() === "POST" &&
      LOGIN_URI_PATTERNS.some((re) => re.test(s.uri)),
  );
}
const REFRESH_URI_PATTERNS = [/\/refresh\/?$/i, /\/auth\/refresh\/?$/i, /\/token\/refresh\/?$/i];
const LOGOUT_URI_PATTERNS = [/\/logout\/?$/i, /\/signout\/?$/i, /\/sign-out\/?$/i];

/**
 * Caminos donde suele venir el token en la respuesta, en orden de
 * probabilidad. El script los prueba todos en ejecución: es más robusto
 * que pedirle al usuario que averigüe cuál es el suyo.
 */
const TOKEN_RESPONSE_PATHS = [
  "access_token",
  "token",
  "accessToken",
  "data.access_token",
  "data.token",
  "data.accessToken",
  "jwt",
  "id_token",
];

/** Campos del body de login que son el usuario. */
const USERNAME_FIELDS = ["email", "username", "user", "login", "correo", "usuario"];
/** Campos del body de login que son la contraseña. */
const PASSWORD_FIELDS = ["password", "passwd", "pass", "secret", "contrasena", "contraseña"];

/**
 * Localiza los endpoints de login, refresh y logout en la colección.
 * Devuelve `null` si el proyecto no tiene ninguno.
 */
export function detectAuthFlow(collection: PostmanCollection): IAuthFlow | null {
  const requests = [...eachRequest(collection.item ?? [])];

  const login = requests.find((i) => matchesAny(i, LOGIN_URI_PATTERNS, ["POST"])) ?? null;
  const refresh = requests.find((i) => matchesAny(i, REFRESH_URI_PATTERNS, ["POST"])) ?? null;
  const logout =
    requests.find((i) => matchesAny(i, LOGOUT_URI_PATTERNS, ["POST", "GET", "DELETE"])) ?? null;

  if (!login && !refresh && !logout) return null;
  return { login, refresh, logout };
}

/**
 * Cablea el flujo de autenticación sobre una colección ya construida:
 *
 *   - Login y refresh guardan el token al responder 2xx.
 *   - El body del login referencia `{{authUsername}}` / `{{authPassword}}`.
 *   - Logout limpia el token.
 *   - Se documenta el flujo en la descripción del login.
 *
 * Devuelve el flujo aplicado, o `null` si la colección no tiene auth.
 */
export function applyAuthFlow(
  collection: PostmanCollection,
  options: IApplyAuthFlowOptions = {},
): IAuthFlow | null {
  const flow = detectAuthFlow(collection) ?? detectByName(collection, options.loginEndpointName);
  if (!flow) return null;

  const paths = options.tokenResponsePath?.trim()
    ? [options.tokenResponsePath.trim()]
    : TOKEN_RESPONSE_PATHS;

  // Se **añade** al array, no se sustituye. El builder ya le ha puesto a
  // cada request sus aserciones, y asignar el array entero se las
  // llevaría por delante justo en los tres endpoints donde más falta
  // hacen: los del ciclo de sesión.
  if (flow.login) {
    flow.login.event = [...(flow.login.event ?? []), tokenCaptureEvent(paths)];
    flow.login.description = LOGIN_DESCRIPTION;
    attachCredentialTemplate(flow.login);
  }
  if (flow.refresh) {
    flow.refresh.event = [...(flow.refresh.event ?? []), tokenCaptureEvent(paths)];
  }
  if (flow.logout) {
    flow.logout.event = [...(flow.logout.event ?? []), tokenClearEvent()];
  }

  return flow;
}

/**
 * Variables que el environment necesita para el flujo de auth.
 * Se añaden solo si la colección tiene login.
 */
export function authEnvironmentVariables(): Array<{
  key: string;
  value: string;
  type: string;
}> {
  return [
    { key: AUTH_USERNAME_VARIABLE, value: "", type: "secret" },
    { key: AUTH_PASSWORD_VARIABLE, value: "", type: "secret" },
    { key: AUTH_TOKEN_VARIABLE, value: "", type: "secret" },
  ];
}

// ---------------------------------------------------------------------------
// Scripts de Postman
// ---------------------------------------------------------------------------

const LOGIN_DESCRIPTION = [
  "Authentication in three steps:",
  "",
  `1. Fill in \`${AUTH_USERNAME_VARIABLE}\` and \`${AUTH_PASSWORD_VARIABLE}\` in the active environment.`,
  "2. Send this request.",
  `3. The token is stored in \`${AUTH_TOKEN_VARIABLE}\` automatically and every other endpoint uses it.`,
  "",
  "The token is written to the environment, so it survives closing Postman.",
].join("\n");

/**
 * Evento de test que extrae el token y lo guarda.
 *
 * Escribe en `pm.environment` (persiste entre sesiones) y, si no hay
 * environment activo, cae a `pm.collectionVariables`. El `pm.test` hace
 * que el fallo sea visible en el runner en vez de silencioso.
 */
function tokenCaptureEvent(tokenPaths: ReadonlyArray<string>): NonNullable<
  PostmanItem["event"]
>[number] {
  const candidates = tokenPaths.map((p) => `  ${JSON.stringify(p)},`).join("\n");
  return {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "const CANDIDATE_PATHS = [",
        candidates,
        "];",
        "",
        "function readPath(source, path) {",
        "  return path.split('.').reduce(function (acc, key) {",
        "    return acc === null || acc === undefined ? undefined : acc[key];",
        "  }, source);",
        "}",
        "",
        `pm.test('Login returns a token', function () {`,
        "  pm.expect(pm.response.code).to.be.oneOf([200, 201]);",
        "",
        "  let body;",
        "  try {",
        "    body = pm.response.json();",
        "  } catch (err) {",
        "    throw new Error('Response is not JSON: ' + pm.response.text().slice(0, 200));",
        "  }",
        "",
        "  let token;",
        "  for (const path of CANDIDATE_PATHS) {",
        "    const value = readPath(body, path);",
        "    if (typeof value === 'string' && value.length > 0) {",
        "      token = value;",
        "      break;",
        "    }",
        "  }",
        "",
        "  if (!token) {",
        "    throw new Error(",
        "      'Token not found in the response. Paths tried: ' +",
        "        CANDIDATE_PATHS.join(', ') +",
        `        '. Declare yours in config.tokenResponsePath.'`,
        "    );",
        "  }",
        "",
        "  // El environment persiste entre sesiones; las collection",
        "  // variables solo mientras la colección esté abierta.",
        "  if (pm.environment.name) {",
        `    pm.environment.set('${AUTH_TOKEN_VARIABLE}', token);`,
        "  } else {",
        `    pm.collectionVariables.set('${AUTH_TOKEN_VARIABLE}', token);`,
        "  }",
        "});",
      ],
    },
  };
}

/** Evento de test del logout: deja el token vacío. */
function tokenClearEvent(): NonNullable<PostmanItem["event"]>[number] {
  return {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "pm.test('Logout clears the token', function () {",
        `  pm.environment.set('${AUTH_TOKEN_VARIABLE}', '');`,
        `  pm.collectionVariables.set('${AUTH_TOKEN_VARIABLE}', '');`,
        "});",
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Body del login
// ---------------------------------------------------------------------------

/**
 * Deja el body del login con las credenciales apuntando al environment,
 * **sin reemplazar nada que no sea una credencial**.
 *
 * `useCredentialVariables` (la versión que sustituye) tenía un caso
 * destructivo: cuando el body no traía `username`/`email`/`password`,
 * machacaba el body entero con un par inventado. Eso rompía los logins
 * OAuth2 con `grant_type`/`client_id`/`client_secret`, los flujos OTP,
 * los formularios `tenant`/`apiKey` y cualquier login que el scanner
 * hubiera descrito con sus campos reales.
 *
 * Esta versión (`a00012 S3.b`) cumple tres reglas:
 *
 *   1. Sólo parchea claves que ya estén en el body y cuyo valor sea un
 *      `string`. Numéricos, booleanos o `null` se respetan: el usuario
 *      probablemente sabe lo que hace.
 *   2. Nunca sustituye el body entero. Si no encuentra credenciales,
 *      deja el body como estaba y avisa con `warnMissingCredentials`.
 *      El caller decide: mostrar la advertencia al usuario, saltarse
 *      el login, o lo que toque.
 *   3. Si encuentra ambas claves (`username`/`password` o
 *      `email`/`password`), escribe los placeholders `{{...}}` encima.
 *      Lo demás del body (campos extra que el scanner sí reconoció) se
 *      conserva.
 *
 * Para login con body vacío o no-JSON el comportamiento es idéntico:
 * no se inventa nada, se avisa.
 */
function attachCredentialTemplate(login: PostmanItem): void {
  const request = login.request;
  if (!request) return;

  const parsed = parseJsonObject(request.body?.raw);
  if (!parsed) {
    warnMissingCredentials({
      reason: "no-json-body",
      path: request.url?.raw ?? "",
    });
    return;
  }

  const usernameKey = findStringField(parsed, USERNAME_FIELDS);
  const passwordKey = findStringField(parsed, PASSWORD_FIELDS);
  if (!usernameKey || !passwordKey) {
    warnMissingCredentials({
      reason: "no-credential-keys",
      path: request.url?.raw ?? "",
      keys: Object.keys(parsed),
    });
    return;
  }

  // Parchea sólo las claves de credencial y deja todo lo demás intacto.
  parsed[usernameKey] = `{{${AUTH_USERNAME_VARIABLE}}}`;
  parsed[passwordKey] = `{{${AUTH_PASSWORD_VARIABLE}}}`;
  writeJsonBody(login, parsed);
}

/**
 * Primera clave del objeto que esté en `candidates` (case-insensitive)
 * **y cuyo valor sea `string`**. Si el body tiene `email: 1` (un
 * scanner que rellenó con un placeholder numérico), no se considera
 * credencial: se respeta.
 */
function findStringField(
  body: Record<string, unknown>,
  candidates: ReadonlyArray<string>,
): string | undefined {
  for (const key of Object.keys(body)) {
    if (!candidates.includes(key.toLowerCase())) continue;
    if (typeof body[key] !== "string") continue;
    return key;
  }
  return undefined;
}

/**
 * Forma del aviso estructurado que `attachCredentialTemplate` emite
 * cuando el body del login no expone las claves que esperaba.
 *
 * Sale por `console.warn` como JSON de una sola línea, así un runner o
 * un parser externo puede leerlo sin regex sobre un mensaje libre.
 * Los tests sustituyen `console.warn` con `vi.spyOn` para verificarlo.
 */
export interface IMissingCredentialsWarning {
  readonly kind: "missing-credentials";
  readonly reason: "no-json-body" | "no-credential-keys";
  /** `raw` de la URL del item, para que el aviso apunte al endpoint. */
  readonly path: string;
  /** Claves del body en el momento del aviso; sólo con `no-credential-keys`. */
  readonly keys?: ReadonlyArray<string>;
}

/**
 * Emite un aviso estructurado cuando el login body no expone
 * credenciales reconocibles. La función es exportada para tests y para
 * que un llamador pueda redirigirla si necesita otro sink.
 */
export function warnMissingCredentials(
  warning: Omit<IMissingCredentialsWarning, "kind">,
): void {
  const payload: IMissingCredentialsWarning = { kind: "missing-credentials", ...warning };
  console.warn(JSON.stringify(payload));
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJsonBody(item: PostmanItem, body: Record<string, unknown>): void {
  if (!item.request) return;
  item.request.body = {
    mode: "raw",
    raw: JSON.stringify(body, null, 2),
    options: { raw: { language: "json" } },
  };
  const hasContentType = item.request.header.some(
    (h) => h.key.toLowerCase() === "content-type",
  );
  if (!hasContentType) {
    item.request.header.push({ key: "Content-Type", value: "application/json", type: "text" });
  }
}

// ---------------------------------------------------------------------------
// Recorrido y matching
// ---------------------------------------------------------------------------

function* eachRequest(items: ReadonlyArray<PostmanItem>): Generator<PostmanItem> {
  for (const item of items) {
    if (item.item) {
      yield* eachRequest(item.item);
      continue;
    }
    if (item.request) yield item;
  }
}

function matchesAny(
  item: PostmanItem,
  patterns: ReadonlyArray<RegExp>,
  methods: ReadonlyArray<string>,
): boolean {
  const method = item.request?.method?.toUpperCase();
  if (!method || !methods.includes(method)) return false;
  const uri = stripQueryAndHost(item.request?.url?.raw ?? "");
  return patterns.some((p) => p.test(uri));
}

/** Quita el host (`{{baseUrl}}`) y la query para comparar solo el path. */
function stripQueryAndHost(raw: string): string {
  const withoutQuery = raw.split("?")[0] ?? "";
  return withoutQuery.replace(/^\{\{[^}]+\}\}/, "");
}

/**
 * Último recurso: si el host declaró `loginEndpointName`, se busca por
 * nombre exacto. Cubre proyectos con rutas de login no convencionales.
 */
function detectByName(
  collection: PostmanCollection,
  loginEndpointName?: string,
): IAuthFlow | null {
  if (!loginEndpointName) return null;
  for (const item of eachRequest(collection.item ?? [])) {
    if (item.name === loginEndpointName) {
      return { login: item, refresh: null, logout: null };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Heurística específica de Laravel
// ---------------------------------------------------------------------------

/**
 * Detecta heurísticamente el dot-path del token en el AuthController de
 * un proyecto Laravel.
 * Mira los archivos `app/Http/Controllers/*Auth*Controller.php` y busca
 * patrones de respuesta. Si no encuentra nada, devuelve undefined.
 */
export async function detectLaravelTokenPath(root: string): Promise<string | undefined> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const ctlDir = path.join(root, "app/Http/Controllers");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(ctlDir);
  } catch {
    return undefined;
  }
  const authFiles = entries.filter(
    (f) => /Auth(entic|oriz)?/i.test(f) && f.endsWith("Controller.php"),
  );
  for (const f of authFiles) {
    const text = await fs.readFile(path.join(ctlDir, f), "utf8").catch(() => "");
    // Patrones comunes: 'access_token' => $t, 'data' => ['token' => ...]
    if (/'access_token'\s*=>/.test(text) || /"access_token"\s*=>/.test(text))
      return "access_token";
    if (/'token'\s*=>\s*\$/.test(text) || /"token"\s*=>\s*\$/.test(text)) {
      // JWT: token suele ir en raíz. Sanctum: suele ir en data.token.
      // Si hay 'data' => 'token', preferimos data.token.
      if (/'data'\s*=>\s*\[[\s\S]*?'token'\s*=>/.test(text)) return "data.token";
      return "token";
    }
    if (/'data'\s*=>\s*\[[\s\S]*?'access_token'\s*=>/.test(text))
      return "data.access_token";
  }
  return undefined;
}

