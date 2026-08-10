/**
 * Parser de schemas Marshmallow → `IValidationSpec`.
 *
 * Marshmallow es la librería de validación más usada en Flask, por
 * delante de `flask-pydantic`. Su forma canónica:
 *
 *   class UserSchema(Schema):
 *       name = fields.Str(required=True, validate=validate.Length(min=1, max=80))
 *       email = fields.Email(required=True)
 *       age = fields.Int(required=False)
 *       role = fields.Str(validate=validate.OneOf(["admin", "user"]))
 *
 * Igual que el resto de parsers del paquete, el análisis es textual: no
 * se importa el módulo del proyecto escaneado.
 */
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";

/** Un schema Marshmallow localizado en el fuente. */
export interface IMarshmallowSchema {
  readonly className: string;
  /** Nombre del campo → expresión `fields.X(...)` completa. */
  readonly fields: ReadonlyMap<string, string>;
  /** Línea (0-based) donde arranca la clase. */
  readonly line: number;
}

/** `class X(Schema):` y sus variantes habituales. */
const SCHEMA_BASE_RE =
  /class\s+(\w+)\s*\(\s*(?:ma\.)?(?:Schema|SQLAlchemyAutoSchema|SQLAlchemySchema)\s*\)\s*:/g;

/** `campo = fields.Tipo(...)`, con indentación de clase. */
const FIELD_RE = /^\s+([a-zA-Z_][\w]*)\s*=\s*((?:ma\.)?fields\.\w+\s*\(.*)$/;

/** `fields.<Tipo>` → tipo lógico del contrato. */
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

/** `fields.<Tipo>` que además implican un formato semántico. */
const FORMAT_MAP: Record<string, string> = {
  Email: "email",
  Url: "url",
  URL: "url",
  UUID: "uuid",
  IP: "ip",
  IPv4: "ipv4",
  IPv6: "ipv6",
};

/** Todos los schemas Marshmallow declarados en un fuente Python. */
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

/** Convierte los campos de un schema en specs del contrato. */
export function marshmallowSchemaToSpecs(
  schema: IMarshmallowSchema,
  location: IValidationSpec["location"] = "body",
): IValidationSpec[] {
  return [...schema.fields].map(([fieldName, expression]) =>
    marshmallowFieldToSpec(fieldName, expression, location),
  );
}

/** Convierte una expresión `fields.X(...)` en un spec. */
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
    // Marshmallow es opcional por defecto y marca lo obligatorio con
    // `required=True`, al revés que zod.
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
