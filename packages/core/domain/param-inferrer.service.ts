/**
 * Agnostic inference of path params, query params, and body for endpoints
 * WITHOUT an associated FormRequest.
 *
 * The package does not depend on any specific Laravel project: the
 * heuristics are **morphological** (URI shape, HTTP method, REST conventions)
 * and apply to ANY project.
 *
 * The decisions it makes are conservative; if a heuristic is not
 * safe, it simply adds nothing. Postman remains useful; we only lose
 * automatic examples for those cases.
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { BodyInference, InferApplyStats } from "../../contracts/interfaces/core/domain.interface.js";
import { DEFAULT_BASE_URL } from "../../contracts/constants/core/base-url.constant.js";

/** Path params detected in a URI already normalized for Postman (`{{x}}`). */
export function extractPathParams(uri: string): string[] {
  return [...uri.matchAll(/\{\{([^}]+)\}\}/g)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined);
}

// ---------------------------------------------------------------------------
// Value suggestions for path params (project-agnostic).
// ---------------------------------------------------------------------------

/** Name patterns → plausible example (camel/snake/kebab-case). */
const PATH_PARAM_HINTS: Array<{ re: RegExp; value: string }> = [
  { re: /(^|_)id($|_)/i, value: "1" },
  { re: /(^|_)codigo($|_)/i, value: "CODIGO001" },
  { re: /(^|_)codigo_proveedor($|_)/i, value: "PROV001" },
  { re: /(^|_)matricula($|_)/i, value: "1234ABC" },
  { re: /^n_/i, value: "10" },
  { re: /(^|_)cantidad($|_)/i, value: "10" },
  { re: /(^|_)precio($|_)/i, value: "19.99" },
  { re: /email/i, value: "user@example.com" },
  { re: /url/i, value: "https://example.com" },
  { re: /uuid/i, value: "00000000-0000-0000-0000-000000000001" },
];

/** If the name looks like a pure identifier (with no semantics), use "1". */
export function exampleForPathParam(name: string): string {
  for (const hint of PATH_PARAM_HINTS) {
    if (hint.re.test(name)) return hint.value;
  }
  return "1";
}

// ---------------------------------------------------------------------------
// Query parameter suggestions (REST-agnostic heuristics).
// ---------------------------------------------------------------------------

const COMMON_QUERY_FIELDS = [
  "q",
  "search",
  "busqueda",
  "query",
  "page",
  "pagina",
  "per_page",
  "items_por_pagina",
  "limit",
  "offset",
  "sort",
  "order",
  "order_by",
  "direction",
  "include",
  "with",
  "filter",
  "from",
  "to",
  "fecha_inicio",
  "fecha_fin",
  "since",
  "until",
  "status",
  "estado",
  "active",
  "activo",
  "lang",
  "locale",
];

const QUERY_FIELD_HINTS: Array<{ re: RegExp; value: string }> = [
  { re: /^id$/i, value: "1" },
  { re: /^q$|^query$|^search$|^busqueda$/i, value: "ejemplo" },
  { re: /^codigo$|^cif$|^nif$/i, value: "COD001" },
  { re: /^nombre$|^razon_social$/i, value: "Nombre de prueba" },
  { re: /^email$/i, value: "user@example.com" },
  { re: /^page$|^pagina$/i, value: "1" },
  { re: /^per_page$|^items_por_pagina$|^limit$/i, value: "10" },
  { re: /^offset$/i, value: "0" },
  { re: /^sort$|^order_by$/i, value: "id" },
  { re: /^direction$|^order$/i, value: "asc" },
  { re: /^status$|^estado$/i, value: "active" },
  { re: /^activo$|^active$/i, value: "true" },
  { re: /^with$|^include$/i, value: "all" },
  { re: /^lang$|^locale$/i, value: "es" },
  { re: /^fecha_inicio$|^from$|^since$/i, value: "2024-01-01" },
  { re: /^fecha_fin$|^to$|^until$/i, value: "2024-12-31" },
];

/**
 * A plausible example value for a query parameter, based on its name.
 *
 * `page` gives a number and `search` gives text. It is pure heuristics: it
 * makes the request runnable without editing it; it does not aim to be exact.
 */
export function exampleForQueryField(name: string): string {
  for (const h of QUERY_FIELD_HINTS) if (h.re.test(name)) return h.value;
  return "ejemplo";
}

// ---------------------------------------------------------------------------
// Body suggestions (POST/PUT/PATCH without a FormRequest).
// ---------------------------------------------------------------------------

const ARRAY_HINT_FIELDS = new Set([
  "tags",
  "categorias",
  "categories",
  "items",
  "productos",
  "usuarios",
  "clientes",
  "ids",
]);

const BOOLEAN_HINT_FIELDS = new Set([
  "activo",
  "active",
  "visible",
  "publico",
  "default",
  "principal",
  "notificar",
  "force",
  "aplicar",
  "reindexar",
]);

function exampleForBodyField(name: string, hint?: string): unknown {
  const lname = name.toLowerCase();
  if (hint) {
    if (/^id$|^codigo$/.test(hint.toLowerCase())) return "1";
  }
  // `lname` is already lowercase, so camelCase suffixes (`Id`, `Codigo`)
  // can only match against the ORIGINAL name. Comparing them against `lname`
  // was comparing them against a string with no uppercase letters: a dead
  // end, and `DepartamentoId` fell back generically instead of using the
  // suffix example.
  if (lname.endsWith("_id") || name.endsWith("Id")) return "1";
  if (lname.endsWith("_codigo") || name.endsWith("Codigo")) return "COD001";
  if (lname === "email") return "user@example.com";
  if (lname === "password" || lname === "pass" || lname === "contrasena")
    return "********";
  if (lname === "name" || lname === "nombre") return "Nombre de prueba";
  if (lname === "description" || lname === "descripcion")
    return "Descripción de ejemplo";
  if (lname === "notes" || lname === "notas") return "Notas";
  if (lname === "url" || lname.endsWith("_url")) return "https://example.com";
  if (lname === "date" || lname.endsWith("_at") || lname === "fecha")
    return "2024-01-15";
  if (
    lname === "amount" ||
    lname === "total" ||
    lname === "precio" ||
    lname === "importe"
  )
    return 19.99;
  if (lname === "quantity" || lname === "cantidad") return 1;
  if (BOOLEAN_HINT_FIELDS.has(lname)) return true;
  if (lname.startsWith("is_") || lname.startsWith("has_")) return true;
  if (ARRAY_HINT_FIELDS.has(lname)) return [1];
  return `sample_${lname}`;
}

/**
 * Attempts to produce a useful body for an endpoint without a FormRequest using
 * REST-agnostic heuristics:
 *
 *   - POST action without path params (e.g. `/usuarios/despersonar`): `{}`.
 *   - POST action with a path param (e.g. `/productos/{{id}}/reindexa`):
 *     adds a `force: true` field if the final segment suggests "reindex",
 *     "cancel", "force", etc.
 *   - PUT/PATCH always includes at least one agnostic boolean/flag field.
 *
 * Returns `null` if it cannot find a safe heuristic.
 */
export function inferBodyForSpec(spec: EndpointSpec): BodyInference | null {
  const method = spec.method.toUpperCase();
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return null;

  const segs = spec.uri.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";

  // Explicit actions on an id → lightweight body contextual to the verb.
  const actionMatch = last.match(
    /(cancel|reindex|reindexa|reactivate|reactivar|restore|restaurar|approve|aprobar|reject|rechazar|disable|enable|resend|reenviar|purge|flush|reset|refresh|sincronizar|importar|exportar|ejecutar|force|publish|publicar)/i,
  );
  if (actionMatch) {
    return {
      reason: `Acción "${actionMatch[1]}" sin FR`,
      body: { force: true },
    };
  }

  // POST /despersonar, /logout → no body needed.
  if (last === "despersonar" || last === "logout" || last === "desactivar") {
    return { reason: `Acción sin body esperado`, body: {} };
  }

  // Generic POST/PUT → body with fields based on the path's resource.
  // Only if the penultimate segment looks like an id (it adds no information).
  const resource = segs.length >= 2 ? (segs[segs.length - 2] ?? "") : "";
  const body: Record<string, unknown> = {};
  // Minimal agnostic body with two generic resource fields.
  if (resource) {
    body["force"] = false;
    body["notes"] = `${method} operation on ${resource}`;
  }
  return body ? { reason: `Genérico para ${method}`, body } : null;
}

/**
 * Generates default query params for a GET endpoint without a FormRequest.
 *
 * - If the URI has path params that suggest a single resource (show), adds
 *   only `with=all` to force relationships.
 * - If it looks like a list/index (URI without `{`, last segment is a
 *   common plural or not a verb), adds pagination + search.
 *
 * Conservative: if it matches nothing, returns `[]`.
 */
export function inferQueryForSpec(spec: EndpointSpec): Array<{
  key: string;
  value: string;
  description: string;
}> {
  if (spec.method.toUpperCase() !== "GET") return [];
  const segs = spec.uri.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  const hasPathParam = extractPathParams(spec.uri).length > 0;

  // show/get: only one id in the URI → adds optional `include`.
  if (hasPathParam) {
    return [
      { key: "include", value: "all", description: "Relaciones a incluir" },
    ];
  }

  // Collection without obvious pagination: add `pagina` and `items_por_pagina`.
  const skipPagination = /alive|auth-test|historial|blacklist|codigos|log|pdf|csv|excel/.test(
    last.toLowerCase(),
  );
  if (skipPagination) {
    return [
      { key: "q", value: "ejemplo", description: "Búsqueda libre" },
    ];
  }
  return [
    { key: "pagina", value: "1", description: "Número de página" },
    { key: "items_por_pagina", value: "20", description: "Tamaño de página" },
    { key: "q", value: "ejemplo", description: "Búsqueda libre" },
  ];
}

// ---------------------------------------------------------------------------
// Collection variable discovery
// ---------------------------------------------------------------------------

/**
 * Builds a set of `{{...}}` variables from an `EndpointSpec` catalog.
 * It is used as a fallback when `ProjectConfig` does not provide a variable
 * list.
 *
 * Agnostic rules:
 *   - `baseUrl`, `token` are always included.
 *   - Any `{{something}}` appearing in URIs is included if it was NOT
 *     already present in `configVariables`.
 *   - The default value is inferred with `exampleForPathParam()`.
 */
export function inferCollectionVariables(
  specs: EndpointSpec[],
  configVariables: Array<{ key: string; value?: string; type?: string }> = [],
): Array<{ key: string; value: string; type: string }> {
  const out = new Map<string, { value: string; type: string }>();

  // The host's declarations take precedence, including their values: overwriting
  // them with "" discarded the production `baseUrl` the project had
  // configured.
  for (const v of configVariables) {
    out.set(v.key, { value: v.value ?? "", type: v.type ?? "string" });
  }

  if (!out.has("baseUrl")) {
    out.set("baseUrl", { value: DEFAULT_BASE_URL, type: "string" });
  }
  if (!out.has("token")) out.set("token", { value: "", type: "string" });

  for (const s of specs) {
    for (const p of extractPathParams(s.uri)) {
      if (!out.has(p)) out.set(p, { value: exampleForPathParam(p), type: "string" });
    }
  }

  return [...out.entries()].map(([key, { value, type }]) => ({ key, value, type }));
}

// ---------------------------------------------------------------------------
// Applying to the catalog
// ---------------------------------------------------------------------------

/**
 * Enriches specs WITHOUT a FormRequest with inferred body and query in an
 * agnostic way. It does NOT touch specs that already have FR or manually
 * supplied body/query.
 */
export function applyAgnosticInference(
  specs: EndpointSpec[],
  options: {
    /** Force inference even when a resolved FR exists. */
    overrideExisting?: boolean;
  } = {},
): InferApplyStats {
  const stats: InferApplyStats = {
    bodiesAdded: 0,
    queriesAdded: 0,
    variableInferred: 0,
    skippedManual: 0,
  };
  for (const s of specs) {
    const fromFR = !!s.formRequest;
    if (fromFR && !options.overrideExisting) continue;

    if (!s.body) {
      const inferred = inferBodyForSpec(s);
      if (inferred) {
        s.body = inferred.body;
        s.description =
          (s.description ?? "") +
          (s.description ? "\n\n" : "") +
          `Body inferido: ${inferred.reason}.`;
        stats.bodiesAdded += 1;
      }
    } else if (!fromFR) {
      stats.skippedManual += 1;
    }

    // A `query: []` and the missing property are the same thing: "without
    // query". An empty array is truthy, so the original guard (`!s.query`)
    // left most specs out of the heuristic, since they arrive with `[]` from
    // the adapter.
    if (!s.query || s.query.length === 0) {
      const q = inferQueryForSpec(s);
      if (q.length > 0) {
        s.query = q;
        stats.queriesAdded += 1;
      }
    }
  }
  return stats;
}

// Re-export so package.json (CLI) can use the helper.
/**
 * Internal pieces exposed **only** for their tests.
 *
 * The underscore is the signal: they are not part of the module contract.
 */
export const _internals = {
  PATH_PARAM_HINTS,
  COMMON_QUERY_FIELDS,
  QUERY_FIELD_HINTS,
  ARRAY_HINT_FIELDS,
  BOOLEAN_HINT_FIELDS,
  exampleForBodyField,
};
