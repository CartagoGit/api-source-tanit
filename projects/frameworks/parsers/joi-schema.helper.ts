/**
 * Parser de schemas Joi → `IValidationSpec`.
 *
 * Joi es la segunda librería de validación más habitual en proyectos
 * Express/Hapi/Koa, y aparece siempre con la misma forma:
 *
 *   const schema = Joi.object({
 *     email: Joi.string().email().required(),
 *     age:   Joi.number().integer().min(0).optional(),
 *     role:  Joi.string().valid("admin", "user"),
 *   });
 *
 * Igual que el parser de zod, el análisis es textual y best-effort: no
 * se ejecuta el código del proyecto escaneado. Los campos que no encajan
 * en la heurística se ignoran en lugar de abortar el escaneo.
 *
 * Nota sobre `required`: Joi es opcional-por-defecto y marca lo
 * obligatorio con `.required()`. Mantenemos la semántica histórica del
 * scanner (obligatorio salvo `.optional()` explícito) porque en la
 * práctica los schemas de request declaran `.required()` en casi todo y
 * un body de ejemplo incompleto es peor que uno con campos de más.
 */
import type { IValidationSpec } from "../../core/contracts/scanner.interface.js";
import { splitTopLevel, unwrapObjectLiteralItem } from "../../core/helpers/source-scan.helper.js";

/** Campo Joi ya parseado, antes de convertirse en `IValidationSpec`. */
export interface IJoiField {
  readonly name: string;
  readonly type: IValidationSpec["type"];
  readonly required: boolean;
  readonly format?: string;
  readonly enumValues?: ReadonlyArray<string>;
  readonly minLength?: number;
  readonly maxLength?: number;
}

/** `Joi.<method>()` → tipo lógico del contrato. */
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

/** Métodos y chainings de Joi que expresan un formato semántico. */
const JOI_FORMAT_MAP: Record<string, string> = {
  email: "email",
  uri: "url",
  url: "url",
  guid: "uuid",
};

const JOI_FIELD_RE = /^([a-zA-Z_$][\w$]*)\s*:\s*Joi\s*\.\s*(\w+)\s*\(([^)]*)\)(.*)$/s;

/**
 * Parsea el interior de un `Joi.object({ ... })` y devuelve sus campos.
 *
 * `body` es el texto entre los paréntesis de la llamada, llaves incluidas.
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

/** Parsea un item `name: Joi.string().email().required()`. */
export function parseJoiFieldExpression(item: string): IJoiField | null {
  const m = JOI_FIELD_RE.exec(item);
  const name = m?.[1];
  const method = m?.[2];
  if (!m || !name || !method) return null;

  const chain = m[4] ?? "";

  // El formato puede venir del método base (`Joi.email()`) o de un
  // chaining posterior (`Joi.string().email()`).
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

/** Convierte un `IJoiField` en el spec agnóstico del contrato. */
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
