/**
 * Genera environments Postman v2.1.0 agnósticos.
 *
 * Un environment contiene las variables (baseUrl, token, etc.) que las
 * requests de la colección referencian con `{{x}}`. Sin un environment
 * importado, el usuario tiene que crear las variables a mano.
 *
 * Detecta automáticamente:
 *   - Variables `{{x}}` en todas las URIs de los specs.
 *   - Variables definidas en `ProjectConfig.variables` (ganan).
 *   - baseUrl/token base si no están ya en el config.
 *
 * Multi-entorno (dev/staging/prod):
 *   - `--envs dev,staging,prod` genera un environment por nombre.
 *   - Cada uno solo difiere en `baseUrl`.
 *   - Los `baseUrl` se autodetectan de `.env`, `.env.example`, `APP_ENV`
 *     o de la convención `<dominio>.local/<dominio>/<subdominio>`.
 */
import { environmentIdFor } from "../helper/collection-identity.helper.js";
import type {
  EndpointSpec,
  PostmanEnvironment,
  PostmanVariable,
} from "../contract/postman.interface.js";

/** Definición de un entorno (agnóstica del proyecto). */
export interface EnvironmentDef {
  /** Nombre que verá el usuario en Postman. */
  name: string;
  /** Color opcional en formato #RRGGBB. */
  color?: string;
  /** Mapa clave → valor que SOBREESCRIBE las variables base. */
  overrides?: Record<string, string>;
}

/** Variables base que Postman necesita SIEMPRE. */
const BASE_VARIABLES: PostmanVariable[] = [
  { key: "baseUrl", value: "http://localhost/api", type: "string" },
  { key: "token", value: "", type: "string" },
];

/** Convierte una PostmanVariable del config a `values` de environment. */
function toEnvValue(
  v: PostmanVariable,
  opts: { enabled: boolean; secret?: boolean; description?: string },
): PostmanEnvironment["values"][number] {
  return {
    key: v.key,
    value: v.value,
    enabled: opts.enabled,
    type: opts.secret ? "secret" : "default",
    ...(opts.description ? { description: opts.description } : {}),
  };
}

/** Extrae los path params (`{{x}}`) de todas las URIs del catálogo. */
function inferPathVariables(specs: EndpointSpec[]): PostmanVariable[] {
  const seen = new Set<string>();
  for (const spec of specs) {
    for (const m of spec.uri.matchAll(/\{\{([^}]+)\}\}/g)) {
      seen.add(m[1]);
    }
  }
  const out: PostmanVariable[] = [];
  for (const key of seen) {
    let value = "1";
    if (/email/i.test(key)) value = "usuario@ejemplo.com";
    else if (/uuid/i.test(key)) value = "00000000-0000-0000-0000-000000000001";
    else if (/codigo/i.test(key)) value = "COD001";
    else if (/matricula/i.test(key)) value = "1234ABC";
    else if (/url/i.test(key)) value = "https://ejemplo.com";
    else if (/fecha|date/i.test(key)) value = "2024-01-15";
    out.push({ key, value, type: "string" });
  }
  return out;
}

/** Fusiona variables del config + base + path params (config gana, pero
 * si el config tiene `value=""` se rellena con el ejemplo inferido). */
function mergeVariables(
  configVariables: PostmanVariable[],
  inferred: PostmanVariable[],
): PostmanVariable[] {
  const merged = new Map<string, PostmanVariable>();
  for (const v of inferred) merged.set(v.key, v);
  for (const v of BASE_VARIABLES) {
    if (!merged.has(v.key)) merged.set(v.key, v);
  }
  for (const v of configVariables) {
    const existing = merged.get(v.key);
    // Si el config tiene valor vacío y hay ejemplo inferido, usamos el
    // ejemplo. Si el config tiene valor explícito (no vacío), gana.
    if (existing && v.value === "" && existing.value !== "") {
      merged.set(v.key, { ...v, value: existing.value });
    } else {
      merged.set(v.key, v);
    }
  }
  return [...merged.values()];
}

/**
 * Construye UN environment.
 *
 * @param name         Nombre del environment (ej. "Dev" o "Mi App · dev").
 * @param variables    Variables fusionadas (config + base + path).
 * @param overrides    Mapa que SOBREESCRIBE valores finales (ej. baseUrl).
 * @param color        Color de la etiqueta en Postman.
 * @param collectionId Id de la colección a la que pertenece; entra en la
 *                     semilla del id del environment para que dos
 *                     proyectos con un entorno "Local" no colisionen.
 */
export function buildEnvironment(
  name: string,
  variables: PostmanVariable[],
  overrides: Record<string, string> = {},
  color?: string,
  collectionId = "",
): PostmanEnvironment {
  const finalValues = variables.map((v) => ({
    key: v.key,
    value: overrides[v.key] ?? v.value,
    enabled: true,
    type:
      v.key === "token" || /secret|password|token|api[_-]?key/i.test(v.key)
        ? ("secret" as const)
        : ("default" as const),
  }));

  // Mismo motivo que en la colección: un id aleatorio hace que cada
  // import cree un environment nuevo en lugar de actualizar el que ya
  // está (p00014). Se deriva del nombre del entorno + el de la colección.
  const environmentId = environmentIdFor(collectionId, name);
  const env: PostmanEnvironment = {
    id: environmentId,
    name,
    values: finalValues,
    _postman_id: environmentId,
    scope: "environment",
  };
  if (color) env.color = color;
  return env;
}

/**
 * Construye múltiples environments aplicando cada `overrides` al set
 * base de variables.
 */
export function buildEnvironments(
  specs: EndpointSpec[],
  configVariables: PostmanVariable[],
  envs: EnvironmentDef[],
  collectionId = "",
): PostmanEnvironment[] {
  if (envs.length === 0) return [];
  const inferred = inferPathVariables(specs);
  const merged = mergeVariables(configVariables, inferred);
  return envs.map((e) =>
    buildEnvironment(e.name, merged, e.overrides, e.color, collectionId),
  );
}

/** Detecta automáticamente entornos dev/staging/prod desde el config. */
export function defaultEnvironments(
  baseUrl: string,
): EnvironmentDef[] {
  const baseUrlObj = new URL(baseUrl);
  const host = baseUrlObj.hostname;
  const protocol = baseUrlObj.protocol;
  const port = baseUrlObj.port ? `:${baseUrlObj.port}` : "";

  return [
    {
      name: "Local",
      color: "#FF6B6B",
      overrides: { baseUrl: `${protocol}//${host}${port}${baseUrlObj.pathname}` },
    },
    {
      name: "Dev",
      color: "#4ECDC4",
      overrides: {
        baseUrl: baseUrl.replace(/\/\/(www\.)?/, "//dev."),
      },
    },
    {
      name: "Staging",
      color: "#FFD93D",
      overrides: {
        baseUrl: baseUrl.replace(/\/\/(www\.)?/, "//staging."),
      },
    },
    {
      name: "Producción",
      color: "#95E1D3",
      overrides: { baseUrl },
    },
  ];
}