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
} from "../contracts/postman.interface.js";

/** Los tres endpoints del ciclo de sesión, si el proyecto los expone. */
export interface IAuthFlow {
  readonly login: PostmanItem | null;
  readonly refresh: PostmanItem | null;
  readonly logout: PostmanItem | null;
}

/** Nombres de variable del environment donde viven las credenciales. */
export const AUTH_USERNAME_VARIABLE = "authUsername";
/** Contraseña del login. Va vacía y marcada como secreto. */
export const AUTH_PASSWORD_VARIABLE = "authPassword";
/**
 * Donde el script del login guarda el token.
 *
 * El nombre está aquí y no escrito en cada sitio porque lo comparten el
 * script que lo guarda, el bloque `auth` de la colección y la cabecera de
 * cada petición: si bailara entre ellos, la colección dejaría de
 * autenticar sin que nada fallara.
 */
export const AUTH_TOKEN_VARIABLE = "token";

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
 * Lo que el host puede declarar para ayudar a cablear la sesión.
 *
 * Las dos son **último recurso**, no configuración esperada: el flujo
 * detecta el login por método y URI, y el token probando los caminos
 * habituales de la respuesta en ejecución. Antes se exigía declarar el
 * camino del token, y el resultado fue que no se activaba en ninguno de
 * los once proyectos de ejemplo.
 */
export interface IApplyAuthFlowOptions {
  /**
   * Camino declarado por el host (`config.tokenResponsePath`). Si viene,
   * es el único que se prueba; si no, se prueban los habituales.
   */
  readonly tokenResponsePath?: string | undefined;
  /**
   * Nombre exacto del endpoint de login declarado por el host. Solo se
   * usa como último recurso, si la detección por URI no encuentra nada.
   */
  readonly loginEndpointName?: string | undefined;
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
    useCredentialVariables(flow.login);
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
 * Deja el body del login con las credenciales apuntando al environment.
 *
 * Dos casos:
 *
 *   - El scanner extrajo los campos reales (`email`/`password`,
 *     `username`/`password`…): se conservan los nombres y solo se
 *     sustituyen los valores.
 *   - No los extrajo: el inferidor agnóstico había rellenado el body con
 *     campos genéricos inventados —`{"force": false, "notes": "Operación
 *     POST sobre auth"}`— que en un login no solo no sirven, sino que
 *     confunden. Se sustituyen por un par de credenciales convencional.
 */
function useCredentialVariables(login: PostmanItem): void {
  const request = login.request;
  if (!request) return;

  const parsed = parseJsonObject(request.body?.raw);
  const usernameKey = parsed && findField(parsed, USERNAME_FIELDS);
  const passwordKey = parsed && findField(parsed, PASSWORD_FIELDS);

  // Body real con credenciales: respetamos los nombres del proyecto.
  if (parsed && usernameKey && passwordKey) {
    parsed[usernameKey] = `{{${AUTH_USERNAME_VARIABLE}}}`;
    parsed[passwordKey] = `{{${AUTH_PASSWORD_VARIABLE}}}`;
    writeJsonBody(login, parsed);
    return;
  }

  // Sin credenciales reconocibles: el body que hubiera es ruido inferido.
  writeJsonBody(login, {
    email: `{{${AUTH_USERNAME_VARIABLE}}}`,
    password: `{{${AUTH_PASSWORD_VARIABLE}}}`,
  });
}

/** Primera clave del objeto que esté en `candidates` (case-insensitive). */
function findField(
  body: Record<string, unknown>,
  candidates: ReadonlyArray<string>,
): string | undefined {
  return Object.keys(body).find((k) => candidates.includes(k.toLowerCase()));
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

