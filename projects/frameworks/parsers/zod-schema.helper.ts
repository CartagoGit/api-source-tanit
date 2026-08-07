/**
 * Parser de schemas zod → `IValidationSpec`.
 *
 * Zod aparece en tres de los frameworks soportados (Express, Next.js y
 * NestJS vía `nestjs-zod`), siempre con la misma forma:
 *
 *   const schema = z.object({
 *     email: z.string().email(),
 *     age:   z.number().int().min(0).optional(),
 *     role:  z.enum(["admin", "user"]),
 *   });
 *
 * El parseo es deliberadamente best-effort y basado en texto: no
 * ejecutamos el módulo del host ni instanciamos zod, porque el proyecto
 * escaneado puede estar en otra versión de node, sin dependencias
 * instaladas, o directamente no ser ejecutable. Lo que no se reconoce se
 * degrada a `type: "string"` en lugar de romper el escaneo.
 */
import type { IValidationSpec } from "../../core/contracts/scanner.interface.js";
import { splitTopLevel, unwrapObjectLiteralItem } from "../../core/helpers/source-scan.helper.js";

/** Campo zod ya parseado, antes de convertirse en `IValidationSpec`. */
export interface IZodField {
  readonly name: string;
  readonly type: IValidationSpec["type"];
  readonly required: boolean;
  readonly format?: string;
  readonly enumValues?: ReadonlyArray<string>;
  /**
   * El argumento de `.min()`, **sin interpretar**.
   *
   * En zod, `.min()` es el mismo método con dos significados según el
   * tipo base: `z.string().min(2)` son dos caracteres y
   * `z.number().min(2)` es el valor dos. Se guarda crudo aquí y lo
   * clasifica `zodFieldToSpec`, que es quien conoce el tipo.
   *
   * Antes iba directo a `minLength`, así que un `z.number().min(0).max(120)`
   * producía un campo numérico con `minLength: 0` y `maxLength: 120` —
   * restricciones que no significan nada sobre un número, y que las
   * herramientas que leen el JSON Schema ignoran. La cota se perdía.
   */
  readonly min?: number;
  readonly max?: number;
}

/** Tipos donde `.min()/.max()` hablan del VALOR, no de la longitud. */
const NUMERIC_TYPES: ReadonlySet<IValidationSpec["type"]> = new Set([
  "number",
  "integer",
]);

/** `z.<method>()` → tipo lógico del contrato. */
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

/** Chainings de zod que expresan un formato semántico. */
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
 * Parsea el interior de un `z.object({ ... })` y devuelve sus campos.
 *
 * `body` es el texto entre los paréntesis de la llamada, llaves incluidas.
 */
export function parseZodObjectLiteral(body: string): IZodField[] {
  const out: IZodField[] = [];
  for (const item of splitTopLevel(body)) {
    const cleaned = unwrapObjectLiteralItem(item);
    if (!cleaned) continue;
    // Acepta identificadores (`foo`) y quoted keys (`"X-API-Key"`).
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

/** Parsea la parte derecha de un campo (`z.string().email()`). */
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

/** Convierte un `IZodField` en el spec agnóstico del contrato. */
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
    // Aquí es donde `.min()` deja de ser ambiguo: sobre un número es una
    // cota de valor, sobre lo demás es de longitud.
    ...(numericBounds(field)),
  };
}

/** Traduce `min`/`max` crudos a la pareja que corresponde al tipo. */
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
