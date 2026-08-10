/**
 * Inferencia agnóstica de path params, query params y body para endpoints
 * SIN FormRequest asociado.
 *
 * El paquete no depende de ningún proyecto Laravel concreto: las
 * heurísticas son **morfológicas** (forma de la URI, método HTTP, convenciones
 * REST) y se aplican a CUALQUIER proyecto.
 *
 * Las decisiones que toma son conservadoras y, si la heurística no es
 * segura, simplemente no añade nada. Postman seguirá siendo útil, solo
 * perderemos ejemplos automáticos para esos casos.
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";

/** Path params detectados en una URI ya normalizada a Postman (`{{x}}`). */
export function extractPathParams(uri: string): string[] {
  return [...uri.matchAll(/\{\{([^}]+)\}\}/g)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined);
}

// ---------------------------------------------------------------------------
// Sugerencias de valor para path params (agnóstico del proyecto).
// ---------------------------------------------------------------------------

/** Patrones del nombre → ejemplo plausible (camel/snake/kebab-case). */
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

/** Si el nombre parece un identificador puro (sin semántica), usa "1". */
export function exampleForPathParam(name: string): string {
  for (const hint of PATH_PARAM_HINTS) {
    if (hint.re.test(name)) return hint.value;
  }
  return "1";
}

// ---------------------------------------------------------------------------
// Sugerencias de query params (heurística REST-agnóstica).
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
 * Un valor de ejemplo plausible para un parámetro de query, por su nombre.
 *
 * `page` da un número y `search` da texto. Es heurística pura: sirve para
 * que la request se pueda lanzar sin editarla, no para acertar.
 */
export function exampleForQueryField(name: string): string {
  for (const h of QUERY_FIELD_HINTS) if (h.re.test(name)) return h.value;
  return "ejemplo";
}

// ---------------------------------------------------------------------------
// Sugerencias de body (POST/PUT/PATCH sin FormRequest).
// ---------------------------------------------------------------------------

/** El body inferido para un endpoint y con qué confianza se dedujo. */
export interface BodyInference {
  /** Filename o heurística que produjo el body. */
  reason: string;
  body: Record<string, unknown>;
}

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
  if (lname.endsWith("_id") || lname.endsWith("Id")) return "1";
  if (lname.endsWith("_codigo") || lname.endsWith("Codigo")) return "COD001";
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
 * Intenta producir un body útil para un endpoint sin FormRequest usando
 * heurísticas REST-agnósticas:
 *
 *   - action POST sin path params (p. ej. `/usuarios/despersonar`): `{}`.
 *   - action POST con path param (p. ej. `/productos/{{id}}/reindexa`):
 *     añade campo `force: true` si el segmento final sugiere "reindex",
 *     "cancel", "force", etc.
 *   - PUT/PATCH siempre lleva al menos un campo booleano/flag agnóstico.
 *
 * Devuelve `null` si no encuentra una heurística segura.
 */
export function inferBodyForSpec(spec: EndpointSpec): BodyInference | null {
  const method = spec.method.toUpperCase();
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return null;

  const segs = spec.uri.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";

  // Acciones explícitas sobre un id → body ligero contextual al verbo.
  const actionMatch = last.match(
    /(cancel|reindex|reindexa|reactivate|reactivar|restore|restaurar|approve|aprobar|reject|rechazar|disable|enable|resend|reenviar|purge|flush|reset|refresh|sincronizar|importar|exportar|ejecutar|force|publish|publicar)/i,
  );
  if (actionMatch) {
    return {
      reason: `Acción "${actionMatch[1]}" sin FR`,
      body: { force: true },
    };
  }

  // POST /despersonar, /logout → no necesita body.
  if (last === "despersonar" || last === "logout" || last === "desactivar") {
    return { reason: `Acción sin body esperado`, body: {} };
  }

  // POST/PUT genérico → body con campos basados en el resource del path.
  // Solo si el penúltimo segmento parece un id (no aporta info).
  const resource = segs.length >= 2 ? (segs[segs.length - 2] ?? "") : "";
  const body: Record<string, unknown> = {};
  // Body mínimo agnóstico con dos campos genéricos del recurso.
  if (resource) {
    body["force"] = false;
    body["notes"] = `${method} operation on ${resource}`;
  }
  return body ? { reason: `Genérico para ${method}`, body } : null;
}

/**
 * Genera query params por defecto para un endpoint GET sin FormRequest.
 *
 * - Si la URI tiene path params que sugieran un único recurso (show),
 *   añade solo `with=all` para forzar relaciones.
 * - Si parece un listado/index (URI sin `{`, último segmento es plural
 *   común o no es un verbo), añade paginación + búsqueda.
 *
 * Conservador: si no encaja con nada, devuelve `[]`.
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

  // show/get: solo un id en URI → añade `include` opcional.
  if (hasPathParam) {
    return [
      { key: "include", value: "all", description: "Relaciones a incluir" },
    ];
  }

  // Colección sin paginación obvia: añadimos `pagina` e `items_por_pagina`.
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
// Descubrimiento de variables de colección
// ---------------------------------------------------------------------------

/**
 * Construye un set de variables `{{...}}` a partir de un catálogo de
 * `EndpointSpec`. Se usa como fallback cuando el `ProjectConfig` no trae
 * ninguna lista de variables.
 *
 * Reglas agnósticas:
 *   - `baseUrl`, `token` siempre se incluyen.
 *   - Cualquier `{{algo}}` que aparezca en URIs se incluye si NO estaba
 *     ya presente en `configVariables`.
 *   - El valor por defecto se infiere con `exampleForPathParam()`.
 */
export function inferCollectionVariables(
  specs: EndpointSpec[],
  configVariables: Array<{ key: string; value?: string; type?: string }> = [],
): Array<{ key: string; value: string; type: string }> {
  const out = new Map<string, { value: string; type: string }>();

  // Lo que el host declara manda, incluidos sus valores: sobrescribirlos
  // con "" tiraba a la basura el `baseUrl` de producción que el proyecto
  // hubiera configurado.
  for (const v of configVariables) {
    out.set(v.key, { value: v.value ?? "", type: v.type ?? "string" });
  }

  if (!out.has("baseUrl")) {
    out.set("baseUrl", { value: "http://localhost/api", type: "string" });
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
// Application al catálogo
// ---------------------------------------------------------------------------

/**
 * Cuánto ha rellenado la inferencia agnóstica.
 *
 * Lo imprime el CLI: es la forma de ver de un vistazo cuánto viene del
 * código y cuánto de una heurística.
 */
export interface InferApplyStats {
  bodiesAdded: number;
  queriesAdded: number;
  variableInferred: number;
  skippedManual: number;
}

/**
 * Enriquece los specs que NO tienen FormRequest con body y query
 * inferidos de forma agnóstica. NO toca los specs que ya tienen FR
 * ni los que ya traen body/query manual.
 */
export function applyAgnosticInference(
  specs: EndpointSpec[],
  options: {
    /** Forzar inferencia aunque haya FR resuelto. */
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

    if (!s.query) {
      const q = inferQueryForSpec(s);
      if (q.length > 0) {
        s.query = q;
        stats.queriesAdded += 1;
      }
    }
  }
  return stats;
}

// Re-export para que el package.json (CLI) pueda usar el helper.
/**
 * Piezas internas expuestas **solo** para sus tests.
 *
 * El guion bajo es la señal: no forman parte del contrato del módulo.
 */
export const _internals = {
  PATH_PARAM_HINTS,
  COMMON_QUERY_FIELDS,
  QUERY_FIELD_HINTS,
  ARRAY_HINT_FIELDS,
  BOOLEAN_HINT_FIELDS,
  exampleForBodyField,
};
