/**
 * Marshmallow schema parser → `IValidationSpec`.
 *
 * Marshmallow is the most-used validation library in Flask, ahead of
 * `flask-pydantic`. Its canonical shape:
 *
 *   class UserSchema(Schema):
 *       name = fields.Str(required=True, validate=validate.Length(min=1, max=80))
 *       email = fields.Email(required=True)
 *       age = fields.Int(required=False)
 *       role = fields.Str(validate=validate.OneOf(["admin", "user"]))
 *
 * Like the rest of the package's parsers, the analysis is textual: the
 * scanned project's module is not imported.
 */
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";
import type { IMarshmallowSchema } from "../../contracts/interfaces/frameworks/scanners.interface.js";

/** `class X(Schema):` and its usual variants. */
const SCHEMA_BASE_RE =
  /class\s+(\w+)\s*\(\s*(?:ma\.)?(?:Schema|SQLAlchemyAutoSchema|SQLAlchemySchema)\s*\)\s*:/g;

/** `field = fields.Type(...)`, with class indentation. */
const FIELD_RE = /^\s+([a-zA-Z_][\w]*)\s*=\s*((?:ma\.)?fields\.\w+\s*\(.*)$/;

/** `fields.<Type>` → logical type of the contract. */
const TYPE_MAP: Record<string, IValidationSpec["type"]> = {
  Str: "string",
  String: "string",
  Int: "integer",
  Integer: "integer",
  Float: "number",
  Decimal: "number",
  Number: "number",
  Bool: "boolean",
  Boolean: "boolean",
  DateTime: "datetime",
  Date: "date",
  Time: "string",
  List: "array",
  Nested: "object",
  Dict: "object",
  Email: "string",
  Url: "string",
  URL: "string",
  UUID: "string",
  Raw: "any",
  Field: "any",
  Enum: "enum",
};

/** `fields.<Type>` that additionally imply a semantic format. */
const FORMAT_MAP: Record<string, string> = {
  Email: "email",
  Url: "url",
  URL: "url",
  UUID: "uuid",
  IP: "ip",
  IPv4: "ipv4",
  IPv6: "ipv6",
};

/** All Marshmallow schemas declared in a Python source file. */
export function parseMarshmallowSchemas(source: string): IMarshmallowSchema[] {
  const out: IMarshmallowSchema[] = [];
  const re = new RegExp(SCHEMA_BASE_RE.source, "g");
  let match: RegExpExecArray | null;

  while ((match = re.exec(source)) !== null) {
    const className = match[1];
    if (!className) continue;

    const bodyStart = match.index + match[0].length;
    const fields = new Map<string, string>();

    for (const line of source.slice(bodyStart).split("\n")) {
      const isDedent = line.trim() !== "" && !/^\s/.test(line);
      if (isDedent) break;
      const fieldMatch = FIELD_RE.exec(line);
      const name = fieldMatch?.[1];
      if (name && !name.startsWith("_")) {
        fields.set(name, (fieldMatch?.[2] ?? "").trim());
      }
    }

    out.push({
      className,
      fields,
      line: source.slice(0, match.index).split("\n").length - 1,
    });
  }
  return out;
}

/** Converts a schema's fields into contract specs. */
export function marshmallowSchemaToSpecs(
  schema: IMarshmallowSchema,
  location: IValidationSpec["location"] = "body",
): IValidationSpec[] {
  return [...schema.fields].map(([fieldName, expression]) =>
    marshmallowFieldToSpec(fieldName, expression, location),
  );
}

/** Converts a `fields.X(...)` expression into a spec. */
export function marshmallowFieldToSpec(
  fieldName: string,
  expression: string,
  location: IValidationSpec["location"] = "body",
): IValidationSpec {
  const kind = /fields\.(\w+)/.exec(expression)?.[1] ?? "Raw";
  const enumValues = readOneOfValues(expression);
  const format = FORMAT_MAP[kind];
  const minLength = readLengthBound(expression, "min");
  const maxLength = readLengthBound(expression, "max");

  return {
    fieldName,
    location,
    type: enumValues ? "enum" : (TYPE_MAP[kind] ?? "any"),
    // Marshmallow is optional by default and marks mandatory fields with
    // `required=True`, the opposite of zod.
    required: /required\s*=\s*True/.test(expression),
    ...(format ? { format } : {}),
    ...(enumValues ? { enumValues } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
  };
}

function readOneOfValues(expression: string): string[] | undefined {
  const m = /OneOf\s*\(\s*\[([^\]]+)\]/.exec(expression);
  if (!m?.[1]) return undefined;
  const values = m[1]
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function readLengthBound(expression: string, bound: "min" | "max"): number | undefined {
  const m = new RegExp(`Length\\s*\\([^)]*\\b${bound}\\s*=\\s*(\\d+)`).exec(expression);
  return m?.[1] ? Number(m[1]) : undefined;
}
