import { isAbsolute } from "node:path";
import { z } from "zod";
import { isRecord, parseJson } from "../../packages/core/helpers/parse-json.helper.js";

const inputPath = z.string().min(1).refine((value) =>
  !isAbsolute(value) && !value.includes("\\") && !value.includes(":") &&
  value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
"Expected a contained relative source path");
const operation = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"]),
  path: z.string().startsWith("/"),
  evidence: z.array(inputPath).min(1),
});
const claim = operation.extend({ status: z.number().int().min(100).max(599) });

/** An oracle records reviewed source facts, never Tanit's own output. */
export const CorpusCaseSchema = z.object({
  version: z.literal(1), id: z.string().regex(/^[a-z0-9-]+$/),
  framework: z.enum(["express", "laravel"]),
  repository: z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  license: z.object({ spdx: z.string().min(1), source: inputPath, note: z.string().optional() }).strict(),
  inputScope: z.string().min(1),
  sourceFiles: z.record(inputPath, z.string().regex(/^[a-f0-9]{64}$/)),
  endpoints: z.array(operation.strict()).min(1),
  responses: z.array(claim.strict()),
  schemaClaims: z.array(claim.extend({
    properties: z.array(z.string().min(1)).min(1),
    types: z.record(z.string(), z.string()).optional(),
  }).strict()),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value.sourceFiles).length === 0 || Object.keys(value.sourceFiles).length > 2000) {
    ctx.addIssue({ code: "custom", message: "Expected 1–2000 verified source files" });
  }
  const keys = value.endpoints.map(operationKey);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Duplicate oracle operation" });
  for (const entry of [...value.endpoints, ...value.responses, ...value.schemaClaims]) {
    if (!keys.includes(operationKey(entry))) ctx.addIssue({ code: "custom", message: "Claim has no oracle endpoint" });
    for (const file of entry.evidence) {
      if (!Object.hasOwn(value.sourceFiles, file)) ctx.addIssue({ code: "custom", message: `Evidence lacks a source hash: ${file}` });
    }
  }
  for (const schema of value.schemaClaims) {
    for (const property of Object.keys(schema.types ?? {})) {
      if (!schema.properties.includes(property)) ctx.addIssue({ code: "custom", message: "A type claim must name a reviewed property" });
    }
  }
  if (!Object.hasOwn(value.sourceFiles, value.license.source)) ctx.addIssue({ code: "custom", message: "License evidence lacks a hash" });
});
export type CorpusCase = z.infer<typeof CorpusCaseSchema>;

export function jsonValue(raw: string): unknown {
  const parsed = parseJson(raw);
  if (!parsed.ok) throw new Error(`Invalid JSON: ${parsed.reason}`);
  return parsed.value;
}

/** Only representation changes are normalized; parameter names remain significant. */
export function normalizePath(value: string): string {
  return "/" + value.replace(/^\{\{baseUrl\}\}/, "").replace(/^\/+|\/+$/g, "")
    .replace(/\{\{([^}]+)\}\}/g, "{$1}").replace(/:([A-Za-z_][\w]*)/g, "{$1}");
}
export function operationKey(value: { method: string; path: string }): string {
  return `${value.method.toUpperCase()} ${normalizePath(value.path)}`;
}


export function endpointMetrics(expected: readonly string[], actual: readonly string[]) {
  const truth = new Set(expected), found = new Set(actual);
  const matched = [...found].filter((key) => truth.has(key)).sort();
  const missing = [...truth].filter((key) => !found.has(key)).sort();
  const unexpected = [...found].filter((key) => !truth.has(key)).sort();
  const duplicates = [...new Set(actual.filter((key, index) => actual.indexOf(key) !== index))].sort();
  return {
    expected: truth.size, actual: found.size, matched: matched.length, missing, unexpected, duplicates,
    precision: found.size === 0 ? null : matched.length / found.size,
    recall: truth.size === 0 ? null : matched.length / truth.size,
    passed: missing.length === 0 && unexpected.length === 0 && duplicates.length === 0,
  };
}

export function canonicalJson(value: unknown): string {
  const order = (item: unknown): unknown => Array.isArray(item) ? item.map(order)
    : isRecord(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, order(item[key])])) : item;
  return JSON.stringify(order(value));
}

/** Collection metadata/IDs are transport details; request and inferred-response data are retained. */
export function postmanOperations(collection: unknown) {
  if (!isRecord(collection) || !Array.isArray(collection.item)) throw new Error("Invalid Postman collection");
  const operations: Array<{ key: string; request: unknown; responses: unknown[]; auth: unknown }> = [];
  const visit = (items: unknown[], depth: number): void => {
    if (depth > 64) throw new Error("Postman nesting exceeds budget");
    for (const item of items) {
      if (!isRecord(item)) throw new Error("Invalid Postman item");
      if (isRecord(item.request)) {
        const request = item.request;
        const raw = typeof request.url === "string" ? request.url : isRecord(request.url) ? request.url.raw : undefined;
        if (typeof request.method !== "string" || typeof raw !== "string") throw new Error("Invalid operation method or URL");
        const path = normalizePath(raw);
        const url = isRecord(request.url) ? { ...request.url, raw: path, host: undefined, path: path.split("/").slice(1) } : path;
        const normalizeBody = (value: unknown): unknown => {
          if (typeof value !== "string") return value;
          const parsed = parseJson(value);
          return parsed.ok ? canonicalJson(parsed.value) : value;
        };
        const body = isRecord(request.body) && request.body.mode === "raw"
          ? { ...request.body, raw: normalizeBody(request.body.raw) } : request.body;
        const responses = Array.isArray(item.response) ? item.response.map((entry) => {
          if (!isRecord(entry)) throw new Error("Invalid inferred response");
          const { id: _id, originalRequest: _request, ...semantic } = entry;
          return { ...semantic, ...(semantic.body !== undefined ? { body: normalizeBody(semantic.body) } : {}) };
        }) : [];
        operations.push({ key: operationKey({ method: request.method, path }), request: { ...request, ...(body !== undefined ? { body } : {}), url }, responses, auth: collection.auth ?? null });
      } else if (Array.isArray(item.item)) visit(item.item, depth + 1);
      else throw new Error("Postman item has neither request nor children");
    }
  };
  visit(collection.item, 0);
  return operations.sort((a, b) => a.key.localeCompare(b.key));
}


/** Unknown claims stay outside the accuracy denominator and retain their own coverage. */
export function claimMetrics(claims: readonly { result: string }[]) {
  const matched = claims.filter((claim) => claim.result === "matched").length;
  const incorrect = claims.filter((claim) => claim.result === "incorrect").length;
  const unknown = claims.length - matched - incorrect;
  const observed = matched + incorrect;
  return {
    expected: claims.length, matched, incorrect, unknown,
    coverage: claims.length === 0 ? null : observed / claims.length,
    accuracyAmongObserved: observed === 0 ? null : matched / observed,
    complete: claims.length === 0 ? null : unknown === 0,
  };
}

function responseSchema(document: unknown, key: string, status: number): unknown {
  if (!isRecord(document) || !isRecord(document.paths)) return undefined;
  const [method, ...parts] = key.split(" ");
  const path = parts.join(" ");
  const pathItem = document.paths[path];
  if (!isRecord(pathItem)) return undefined;
  const operation = pathItem[method?.toLowerCase() ?? ""];
  if (!isRecord(operation) || !isRecord(operation.responses)) return undefined;
  const response = operation.responses[String(status)];
  if (!isRecord(response) || !isRecord(response.content)) return undefined;
  const json = response.content["application/json"];
  return isRecord(json) ? json.schema : undefined;
}

function schemaProperty(document: unknown, schema: unknown, path: string): unknown {
  const dereference = (value: unknown): unknown => {
    const seen = new Set<string>();
    while (isRecord(value) && typeof value.$ref === "string") {
      if (!value.$ref.startsWith("#/") || seen.has(value.$ref)) return undefined;
      seen.add(value.$ref);
      let target: unknown = document;
      for (const segment of value.$ref.slice(2).split("/")) {
        if (!isRecord(target)) return undefined;
        target = target[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
      }
      value = target;
    }
    return value;
  };
  let value = dereference(schema);
  for (const segment of path.split(".")) {
    if (!isRecord(value) || !isRecord(value.properties)) return undefined;
    value = dereference(value.properties[segment]);
  }
  return value;
}

/** Exporter fallback 200s do not count as inference. Sparse oracles do not establish whole-schema accuracy. */
export function assessClaims(corpus: CorpusCase, collection: unknown, openapi: unknown) {
  const operations = postmanOperations(collection);
  const observed = (key: string, status: number): boolean => operations.some((item) => item.key === key && item.responses.some((r) => isRecord(r) && r.code === status));
  const responses = corpus.responses.map((claim) => ({
    key: operationKey(claim), status: claim.status,
    result: observed(operationKey(claim), claim.status) ? "matched" : "unknown",
  }));
  const schemas = corpus.schemaClaims.flatMap((claim) => claim.properties.map((path) => {
    const key = operationKey(claim);
    const property = observed(key, claim.status) ? schemaProperty(openapi, responseSchema(openapi, key, claim.status), path) : undefined;
    const expectedType = claim.types?.[path];
    const actualType = isRecord(property) ? property.type : undefined;
    const result = !isRecord(property) || (expectedType !== undefined && actualType === undefined) ? "unknown"
      : expectedType !== undefined && actualType !== expectedType ? "incorrect" : "matched";
    return { key, status: claim.status, property: path, expectedType, actualType, result };
  }));
  return { responses, schemas, responseMetrics: claimMetrics(responses), schemaMetrics: claimMetrics(schemas), fullResponseSchemaAccuracy: null, scope: "Reviewed positive status/property claims only; missing inference remains unknown" };
}
