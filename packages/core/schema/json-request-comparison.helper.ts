import type { IJsonRequestCheck } from "../../contracts/interfaces/core/client-consumption.interface.js";
import { isRecord, parseJson } from "../helpers/parse-json.helper.js";

function isMetadata(key: string): boolean {
  return ["title", "description", "example", "default", "deprecated", "externalDocs"].includes(key);
}

function matchesScalar(type: string, value: unknown, nullable: boolean): boolean {
  if (value === null) return nullable;
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function readScalar(schema: unknown) {
  if (!isRecord(schema) || Object.keys(schema).some((key) =>
    !isMetadata(key) && !["type", "nullable", "enum"].includes(key))) return undefined;

  const { type, nullable = false, enum: values } = schema;
  if (typeof type !== "string" || !["string", "boolean", "number", "integer"].includes(type) ||
      typeof nullable !== "boolean") return undefined;

  if (values !== undefined && (!Array.isArray(values) || values.length === 0 || values.length > 64 ||
      !values.every((value: unknown) => matchesScalar(type, value, nullable) &&
        (typeof value !== "number" || !Number.isInteger(value) || Number.isSafeInteger(value))))) {
    return undefined;
  }
  return { type, nullable, values };
}

function readClosedObject(schema: unknown) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false ||
      Object.keys(schema).some((key) =>
        !isMetadata(key) && !["type", "additionalProperties", "properties", "required"].includes(key))) {
    return undefined;
  }

  const { properties = {}, required = [] } = schema;
  if (!isRecord(properties) || !Array.isArray(required) || required.length > 64 ||
      !required.every((field: unknown): field is string =>
        typeof field === "string" && Object.hasOwn(properties, field)) ||
      new Set(required).size !== required.length) return undefined;

  const entries = Object.entries(properties);
  if (entries.length > 64) return undefined;
  const fields = new Map<string, NonNullable<ReturnType<typeof readScalar>>>();
  for (const [field, declaration] of entries) {
    const scalar = readScalar(declaration);
    if (scalar === undefined) return undefined;
    fields.set(field, scalar);
  }
  return { fields, required };
}

function hasUnambiguousJsonTokens(body: string): boolean {
  // Inspect keys and numbers before parsing hides duplicates or rounds a value.
  const fields = new Set<string>();
  const tokens = body.matchAll(/("(?:\\.|[^"\\])*")(\s*:)?|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/gu);
  for (const token of tokens) {
    const [, key, colon, spelling] = token;
    if (key !== undefined && colon !== undefined) {
      const parsed = parseJson(key);
      if (!parsed.ok || typeof parsed.value !== "string" || fields.has(parsed.value)) return false;
      fields.add(parsed.value);
    }
    if (spelling === undefined) continue;
    const value = Number(spelling);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)) ||
        JSON.stringify(value) !== spelling) return false;
  }
  return true;
}

/** Checks an observed JSON body against a bounded, explicit OpenAPI 3.0 object declaration. */
export function compareJsonRequestBody(schema: unknown, body: string): IJsonRequestCheck {
  const declared = readClosedObject(schema);
  if (declared === undefined) return { verdict: "unknown", reason: "unsupported-schema" };
  if (body.length > 65_536) return { verdict: "unknown", reason: "unsupported-json" };

  const parsed = parseJson(body);
  if (!parsed.ok) return { verdict: "incompatible", reason: "invalid-json" };
  if (!hasUnambiguousJsonTokens(body)) return { verdict: "unknown", reason: "unsupported-json" };
  if (!isRecord(parsed.value)) return { verdict: "incompatible", reason: "type-mismatch" };
  const payload = parsed.value;

  for (const field of declared.required) {
    if (!Object.hasOwn(payload, field)) return { verdict: "incompatible", reason: "missing-field", field };
  }
  for (const [field, value] of Object.entries(payload)) {
    const property = declared.fields.get(field);
    // No report value is sourced from the payload, including an undeclared key.
    if (property === undefined) return { verdict: "incompatible", reason: "unexpected-field" };
    if (!matchesScalar(property.type, value, property.nullable)) {
      return { verdict: "incompatible", reason: "type-mismatch", field };
    }
    if (property.values !== undefined && !property.values.includes(value)) {
      return { verdict: "incompatible", reason: "enum-mismatch", field };
    }
  }
  return { verdict: "compatible" };
}
