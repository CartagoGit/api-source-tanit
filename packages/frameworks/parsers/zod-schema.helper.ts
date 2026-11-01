/**
 * Zod schema parser → `IValidationSpec`.
 *
 * Zod appears in three of the supported frameworks (Express, Next.js
 * and NestJS via `nestjs-zod`), always in the same shape:
 *
 *   const schema = z.object({
 *     email: z.string().email(),
 *     age:   z.number().int().min(0).optional(),
 *     role:  z.enum(["admin", "user"]),
 *   });
 *
 * Parsing is deliberately best-effort and text-based: we don't run the
 * host's module or instantiate zod, because the scanned project may be
 * on a different node version, with dependencies not installed, or not
 * runnable at all. What isn't recognised is downgraded to
 * `type: "string"` instead of breaking the scan.
 */
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";
import { splitTopLevel, unwrapObjectLiteralItem } from "../../core/helpers/source-scan.helper.js";
import type { IZodField } from "../../contracts/interfaces/frameworks/scanners.interface.js";

/** Types where `.min()/.max()` refer to the VALUE, not to length. */
const NUMERIC_TYPES: ReadonlySet<IValidationSpec["type"]> = new Set([
  "number",
  "integer",
]);

/** `z.<method>()` → logical type of the contract. */
const ZOD_TYPE_MAP: Record<string, IValidationSpec["type"]> = {
  string: "string",
  number: "number",
  bigint: "number",
  boolean: "boolean",
  date: "date",
  array: "array",
  object: "object",
  null: "any",
  undefined: "any",
  any: "any",
  unknown: "any",
  never: "any",
  void: "any",
  literal: "enum",
  enum: "enum",
  nativeEnum: "enum",
};

/** Zod chainings that express a semantic format. */
const ZOD_FORMAT_MAP: Record<string, string> = {
  email: "email",
  url: "url",
  uuid: "uuid",
  cuid: "cuid",
  cuid2: "cuid2",
  ulid: "ulid",
  ip: "ip",
  ipv4: "ipv4",
  ipv6: "ipv6",
  datetime: "date-time",
};

const ZOD_CHAIN_RE = /\.\s*([a-zA-Z_][\w]*)\s*\(/g;

/**
 * Parses the inside of a `z.object({ ... })` and returns its fields.
 *
 * `body` is the text between the call's parentheses, braces included.
 */
export function parseZodObjectLiteral(body: string): IZodField[] {
  const out: IZodField[] = [];
  for (const item of splitTopLevel(body)) {
    const cleaned = unwrapObjectLiteralItem(item);
    if (!cleaned) continue;
    // Accepts identifiers (`foo`) and quoted keys (`"X-API-Key"`).
    const m = /^(?:["']([^"']+)["']|([a-zA-Z_$][\w$]*))\s*:\s*(.+)$/s.exec(cleaned);
    if (!m) continue;
    const name = m[1] ?? m[2];
    const expr = m[3]?.trim();
    if (!name || !expr) continue;
    const field = parseZodFieldExpression(name, expr);
    if (field) out.push(field);
  }
  return out;
}

/** Parses the right-hand side of a field (`z.string().email()`). */
export function parseZodFieldExpression(name: string, expr: string): IZodField | null {
  const baseMatch = /z\s*\.\s*([a-zA-Z_][\w]*)\s*\(/.exec(expr);
  if (!baseMatch?.[1]) return null;

  const type = ZOD_TYPE_MAP[baseMatch[1]] ?? "string";
  let format: string | undefined;

  for (const chain of expr.matchAll(ZOD_CHAIN_RE)) {
    const method = chain[1];
    if (!method) continue;
    const mapped = ZOD_FORMAT_MAP[method];
    if (mapped) format = mapped;
  }

  const min = readNumericChain(expr, "min");
  const max = readNumericChain(expr, "max");
  const enumValues = readEnumValues(expr);
  const isOptional = /\.\s*(?:optional|nullable|nullish)\s*\(/.test(expr);

  return {
    name,
    type: enumValues ? "enum" : type,
    required: !isOptional,
    ...(format ? { format } : {}),
    ...(enumValues ? { enumValues } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
}

/** Converts an `IZodField` into the contract's agnostic spec. */
export function zodFieldToSpec(
  field: IZodField,
  location: IValidationSpec["location"] = "body",
): IValidationSpec {
  return {
    fieldName: field.name,
    location,
    type: field.type,
    required: field.required,
    ...(field.format ? { format: field.format } : {}),
    ...(field.enumValues ? { enumValues: field.enumValues } : {}),
    // Here is where `.min()` stops being ambiguous: on a number it's a
    // value bound, on everything else it's a length bound.
    ...(numericBounds(field)),
  };
}

/** Translates raw `min`/`max` into the pair that matches the type. */
function numericBounds(field: IZodField): Partial<IValidationSpec> {
  const isNumeric = NUMERIC_TYPES.has(field.type);
  return {
    ...(field.min !== undefined
      ? isNumeric
        ? { minimum: field.min }
        : { minLength: field.min }
      : {}),
    ...(field.max !== undefined
      ? isNumeric
        ? { maximum: field.max }
        : { maxLength: field.max }
      : {}),
  };
}

function readNumericChain(expr: string, method: "min" | "max"): number | undefined {
  const m = new RegExp(`\\.\\s*${method}\\s*\\(\\s*(\\d+)\\s*\\)`).exec(expr);
  return m?.[1] ? Number(m[1]) : undefined;
}

function readEnumValues(expr: string): string[] | undefined {
  const m = /\.\s*enum\s*\(\s*\[([^\]]+)\]\s*\)/.exec(expr);
  if (!m?.[1]) return undefined;
  const values = m[1]
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}
