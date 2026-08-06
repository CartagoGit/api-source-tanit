/**
 * Parser de modelos Pydantic → `IValidationSpec`.
 *
 * Pydantic aparece en FastAPI (donde es la forma canónica) y en Flask
 * vía `flask-pydantic`. Vivía dentro de `fastapi.scanner.ts`, así que
 * Flask no podía aprovecharlo y se quedaba sin bodies reales.
 *
 *   class UserCreate(BaseModel):
 *       name: str
 *       email: EmailStr
 *       age: Optional[int] = None
 *       role: Literal["admin", "user"] = "user"
 *
 * El análisis es textual: no se importa el módulo del proyecto
 * escaneado, que puede estar en otra versión de Python o sin instalar.
 */
import type { IValidationSpec } from "../../contract/scanner.interface.js";

/** Un modelo Pydantic localizado en el fuente. */
export interface IPydanticModel {
  readonly className: string;
  /** Nombre del campo → anotación de tipo tal cual aparece. */
  readonly fields: ReadonlyMap<string, string>;
  /** Línea (0-based) donde arranca la clase. */
  readonly line: number;
}

/** Clases base que identifican un modelo parseable. */
const MODEL_BASE_RE = /class\s+(\w+)\s*\(\s*(?:BaseModel|pydantic\.BaseModel)\s*\)\s*:/g;

/** `campo: tipo` o `campo: tipo = valor`, con indentación de clase. */
const FIELD_RE = /^\s+([a-zA-Z_][\w]*)\s*:\s*([^\n=]+?)\s*(?:=\s*(.+?))?\s*$/;

const TYPE_MAP: Record<string, IValidationSpec["type"]> = {
  str: "string",
  int: "integer",
  float: "number",
  Decimal: "number",
  bool: "boolean",
  List: "array",
  dict: "object",
  Dict: "object",
  datetime: "datetime",
  date: "date",
  time: "string",
  bytes: "string",
  UUID: "string",
  Any: "any",
  Optional: "any",
  Literal: "enum",
};

/** Tipos de Pydantic que expresan un formato semántico. */
const FORMAT_MAP: Record<string, string> = {
  EmailStr: "email",
  HttpUrl: "url",
  AnyUrl: "url",
  AnyHttpUrl: "url",
  UUID1: "uuid",
  UUID3: "uuid",
  UUID4: "uuid",
  UUID5: "uuid",
  UUID: "uuid",
  IPvAnyAddress: "ip",
  IPv4Address: "ipv4",
  IPv6Address: "ipv6",
};

/**
 * Todos los modelos Pydantic declarados en un fuente Python.
 *
 * El final de la clase se detecta por indentación: la primera línea no
 * vacía que arranque en la columna 0 la cierra.
 */
export function parsePydanticModels(source: string): IPydanticModel[] {
  const out: IPydanticModel[] = [];
  const re = new RegExp(MODEL_BASE_RE.source, "g");
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

/** Convierte los campos de un modelo en specs del contrato. */
export function pydanticModelToSpecs(
  model: IPydanticModel,
  location: IValidationSpec["location"] = "body",
): IValidationSpec[] {
  return [...model.fields].map(([fieldName, annotation]) =>
    pydanticFieldToSpec(fieldName, annotation, location),
  );
}

/** Convierte una anotación de tipo en un spec. */
export function pydanticFieldToSpec(
  fieldName: string,
  annotation: string,
  location: IValidationSpec["location"] = "body",
): IValidationSpec {
  const format = mapPydanticFormat(annotation);
  const enumValues = readLiteralValues(annotation);

  return {
    fieldName,
    location,
    type: enumValues ? "enum" : mapPydanticType(annotation),
    required: isPydanticRequired(annotation),
    ...(format ? { format } : {}),
    ...(enumValues ? { enumValues } : {}),
  };
}

/** Anotación → tipo lógico del contrato. */
export function mapPydanticType(annotation: string): IValidationSpec["type"] {
  // Los tipos con formato (EmailStr, HttpUrl…) siguen siendo strings.
  for (const name of Object.keys(FORMAT_MAP)) {
    if (annotation.includes(name)) return "string";
  }
  const base = annotation
    .replace(/Optional\[(.*)\]/, "$1")
    .replace(/List\[(.*)\]/, "List")
    .replace(/Sequence\[(.*)\]/, "List")
    .replace(/Set\[(.*)\]/, "List")
    .replace(/Tuple\[(.*)\]/, "List")
    .replace(/Dict\[.*\]/, "dict")
    .replace(/\s+/g, "");
  return TYPE_MAP[base] ?? "any";
}

/** Anotación → formato semántico, si lo hay. */
export function mapPydanticFormat(annotation: string): string | undefined {
  for (const [name, format] of Object.entries(FORMAT_MAP)) {
    if (annotation.includes(name)) return format;
  }
  return undefined;
}

/** Un campo es obligatorio salvo que sea `Optional` o tenga default. */
export function isPydanticRequired(annotation: string): boolean {
  return !annotation.includes("Optional") && !annotation.includes("None");
}

function readLiteralValues(annotation: string): string[] | undefined {
  const m = /Literal\[([^\]]+)\]/.exec(annotation);
  if (!m?.[1]) return undefined;
  const values = m[1]
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}
