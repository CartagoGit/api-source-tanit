/**
 * Pydantic model parser → `IValidationSpec`.
 *
 * Pydantic appears in FastAPI (where it is the canonical form) and in
 * Flask via `flask-pydantic`. It used to live inside
 * `fastapi.scanner.ts`, so Flask could not reuse it and ended up with
 * no real bodies.
 *
 *   class UserCreate(BaseModel):
 *       name: str
 *       email: EmailStr
 *       age: Optional[int] = None
 *       role: Literal["admin", "user"] = "user"
 *
 * The analysis is textual: the scanned project's module is not
 * imported — it may be on another Python version or not installed at
 * all.
 */
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";
import type { IPydanticModel } from "../../contracts/interfaces/frameworks/scanners.interface.js";

/** Base classes that identify a parseable model. */
const MODEL_BASE_RE = /class\s+(\w+)\s*\(\s*(?:BaseModel|pydantic\.BaseModel)\s*\)\s*:/g;

/** `field: type` or `field: type = value`, with class indentation. */
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

/** Pydantic types that express a semantic format. */
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
 * All Pydantic models declared in a Python source file.
 *
 * The end of the class is detected by indentation: the first non-blank
 * line starting at column 0 closes it.
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

/** Converts a model's fields into contract specs. */
export function pydanticModelToSpecs(
  model: IPydanticModel,
  location: IValidationSpec["location"] = "body",
): IValidationSpec[] {
  return [...model.fields].map(([fieldName, annotation]) =>
    pydanticFieldToSpec(fieldName, annotation, location),
  );
}

/** Converts a type annotation into a spec. */
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

/** Annotation → logical type of the contract. */
export function mapPydanticType(annotation: string): IValidationSpec["type"] {
  // Types with a format (EmailStr, HttpUrl…) are still strings.
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

/** Annotation → semantic format, if any. */
export function mapPydanticFormat(annotation: string): string | undefined {
  for (const [name, format] of Object.entries(FORMAT_MAP)) {
    if (annotation.includes(name)) return format;
  }
  return undefined;
}

/** A field is required unless it is `Optional` or has a default. */
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
