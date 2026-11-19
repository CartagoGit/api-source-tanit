/**
 * Joi schema parser → `IValidationSpec`.
 *
 * Joi is the second most common validation library in Express/Hapi/Koa
 * projects, and always appears in the same shape:
 *
 *   const schema = Joi.object({
 *     email: Joi.string().email().required(),
 *     age:   Joi.number().integer().min(0).optional(),
 *     role:  Joi.string().valid("admin", "user"),
 *   });
 *
 * Like the zod parser, the analysis is textual and best-effort: the
 * scanned project's code is not executed. Fields that don't fit the
 * heuristic are skipped instead of aborting the scan.
 *
 * Note on `required`: Joi is optional-by-default and marks things as
 * mandatory with `.required()`. We keep the scanner's historical
 * semantics (required unless explicitly `.optional()`) because in
 * practice request schemas declare `.required()` on almost everything,
 * and an incomplete example body is worse than one with extra fields.
 */
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";
import { splitTopLevel, unwrapObjectLiteralItem } from "../../core/helpers/source-scan.helper.js";
import type { IJoiField } from "../../contracts/interfaces/frameworks/scanners.interface.js";

/** `Joi.<method>()` → logical type of the contract. */
const JOI_TYPE_MAP: Record<string, IValidationSpec["type"]> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  date: "date",
  array: "array",
  object: "object",
  email: "string",
  uri: "string",
  url: "string",
  guid: "string",
  integer: "integer",
  any: "any",
};

/** Joi methods and chainings that express a semantic format. */
const JOI_FORMAT_MAP: Record<string, string> = {
  email: "email",
  uri: "url",
  url: "url",
  guid: "uuid",
};

const JOI_FIELD_RE = /^([a-zA-Z_$][\w$]*)\s*:\s*Joi\s*\.\s*(\w+)\s*\(([^)]*)\)(.*)$/s;

/**
 * Parses the inside of a `Joi.object({ ... })` and returns its fields.
 *
 * `body` is the text between the call's parentheses, braces included.
 */
export function parseJoiObjectLiteral(body: string): IJoiField[] {
  const out: IJoiField[] = [];
  for (const item of splitTopLevel(body)) {
    const cleaned = unwrapObjectLiteralItem(item);
    if (!cleaned) continue;
    const field = parseJoiFieldExpression(cleaned);
    if (field) out.push(field);
  }
  return out;
}

/** Parses an item `name: Joi.string().email().required()`. */
export function parseJoiFieldExpression(item: string): IJoiField | null {
  const m = JOI_FIELD_RE.exec(item);
  const name = m?.[1];
  const method = m?.[2];
  if (!m || !name || !method) return null;

  const chain = m[4] ?? "";

  // The format can come from the base method (`Joi.email()`) or from a
  // later chaining (`Joi.string().email()`).
  let format = JOI_FORMAT_MAP[method];
  for (const [chainMethod, mapped] of Object.entries(JOI_FORMAT_MAP)) {
    if (new RegExp(`\\.\\s*${chainMethod}\\s*\\(`).test(chain)) format = mapped;
  }

  const minLength = readNumericChain(chain, "min");
  const maxLength = readNumericChain(chain, "max");
  const enumValues = readValidValues(chain);

  return {
    name,
    type: JOI_TYPE_MAP[method] ?? "string",
    required: !/\.\s*optional\s*\(/.test(chain),
    ...(format ? { format } : {}),
    ...(enumValues ? { enumValues } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
  };
}

/** Converts an `IJoiField` into the contract's agnostic spec. */
export function joiFieldToSpec(
  field: IJoiField,
  location: IValidationSpec["location"] = "body",
): IValidationSpec {
  return {
    fieldName: field.name,
    location,
    type: field.type,
    required: field.required,
    ...(field.format ? { format: field.format } : {}),
    ...(field.enumValues ? { enumValues: field.enumValues } : {}),
    ...(field.minLength !== undefined ? { minLength: field.minLength } : {}),
    ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
  };
}

function readNumericChain(chain: string, method: "min" | "max"): number | undefined {
  const m = new RegExp(`\\.\\s*${method}\\s*\\(\\s*(\\d+)\\s*\\)`).exec(chain);
  return m?.[1] ? Number(m[1]) : undefined;
}

function readValidValues(chain: string): string[] | undefined {
  const m = /\.\s*valid\s*\(\s*([^)]+)\s*\)/.exec(chain);
  if (!m?.[1]) return undefined;
  const values = m[1]
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}
