/**
 * Generates agnostic Postman v2.1.0 environments.
 *
 * An environment contains the variables (baseUrl, token, etc.) that the
 * collection's requests reference with `{{x}}`. Without an imported
 * environment, the user has to create the variables manually.
 *
 * Automatically detects:
 *   - `{{x}}` variables in all spec URIs.
 *   - Variables defined in `ProjectConfig.variables` (they win).
 *   - Default baseUrl/token if they are not already in the config.
 *
 * Multi-environment (dev/staging/prod):
 *   - `--envs dev,staging,prod` generates one environment per name.
 *   - Each differs only in `baseUrl`.
 *   - `baseUrl` values are auto-detected from `.env`, `.env.example`,
 *     `APP_ENV`, or the `<domain>.local/<domain>/<subdomain>` convention.
 */
import { environmentIdFor } from "../helpers/collection-identity.helper.js";
import type {
  EndpointSpec,
  PostmanEnvironment,
  PostmanVariable,
} from "../../contracts/interfaces/core/postman.interface.js";
import type { EnvironmentDef } from "../../contracts/interfaces/core/domain.interface.js";
import { DEFAULT_BASE_URL } from "../../contracts/constants/core/base-url.constant.js";

/** Base variables that Postman ALWAYS needs. */
const BASE_VARIABLES: PostmanVariable[] = [
  { key: "baseUrl", value: DEFAULT_BASE_URL, type: "string" },
  { key: "token", value: "", type: "string" },
];


/** Extracts path params (`{{x}}`) from all URIs in the catalog. */
function inferPathVariables(specs: EndpointSpec[]): PostmanVariable[] {
  const seen = new Set<string>();
  for (const spec of specs) {
    for (const m of spec.uri.matchAll(/\{\{([^}]+)\}\}/g)) {
      if (m[1] !== undefined) seen.add(m[1]);
    }
  }
  const out: PostmanVariable[] = [];
  for (const key of seen) {
    let value = "1";
    if (/email/i.test(key)) value = "user@example.com";
    else if (/uuid/i.test(key)) value = "00000000-0000-0000-0000-000000000001";
    else if (/codigo/i.test(key)) value = "COD001";
    else if (/matricula/i.test(key)) value = "1234ABC";
    else if (/url/i.test(key)) value = "https://example.com";
    else if (/fecha|date/i.test(key)) value = "2024-01-15";
    out.push({ key, value, type: "string" });
  }
  return out;
}

/** Merges config, base, and path variables (config wins, but if the
 * config has `value=""`, it is filled with the inferred example). */
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
    // If the config has an empty value and an inferred example exists, use the
    // example. If the config has an explicit (non-empty) value, it wins.
    if (existing && v.value === "" && existing.value !== "") {
      merged.set(v.key, { ...v, value: existing.value });
    } else {
      merged.set(v.key, v);
    }
  }
  return [...merged.values()];
}

/**
 * Builds ONE environment.
 *
 * @param name         Environment name (e.g. "Dev" or "My App · dev").
 * @param variables    Merged variables (config + base + path).
 * @param overrides    Map that OVERWRITES final values (e.g. baseUrl).
 * @param color        Tag color in Postman.
 * @param collectionId ID of the collection it belongs to; included in the
 *                     environment ID seed so two projects with a "Local"
 *                     environment do not collide.
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

  // Same reason as in the collection: a random ID makes every import create
  // a new environment instead of updating the existing one (p00014). It is
  // derived from the environment name and the collection name.
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
 * Builds multiple environments by applying each set of `overrides` to the
 * base set of variables.
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

/** Automatically detects dev/staging/prod environments from the config. */
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
      name: "Production",
      color: "#95E1D3",
      overrides: { baseUrl },
    },
  ];
}