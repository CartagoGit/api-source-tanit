/**
 * Description of a request: what the endpoint accepts, in a table.
 *
 * The example body shows **one** valid value. That is not the same as
 * saying which values are valid: a `"age": 30` does not show that the maximum
 * is 120, that the field is optional, or that `role` accepts only three
 * values. All of that information **has already been extracted** from the
 * source code to build the example, and it was being discarded.
 *
 * What is documented is what the endpoint **receives**, which is what this
 * project scans. What it returns is unknown, so there are no example
 * responses: see the p00031 note on why inventing them would have been worse
 * than having none.
 */
import type { IEndpointField } from "../../contracts/interfaces/core/postman.interface.js";

/** The locations where a parameter can go, and what to call them. */
const LOCATION_TITLES: Readonly<Record<string, string>> = {
  body: "Body",
  query: "Query",
  path: "Path",
  header: "Headers",
  cookie: "Cookies",
};

/** The order in which they are presented: from most to least common. */
const LOCATION_ORDER = ["body", "query", "path", "header", "cookie"] as const;

/** The constraints on a field, in a cell. */
function constraintsOf(field: IEndpointField): string {
  const parts: string[] = [];
  if (field.format) parts.push(`formato \`${field.format}\``);
  if (field.enumValues && field.enumValues.length > 0) {
    parts.push(`uno de: ${field.enumValues.map((v) => `\`${v}\``).join(", ")}`);
  }
  if (field.minLength !== undefined) parts.push(`mín. ${field.minLength} car.`);
  if (field.maxLength !== undefined) parts.push(`máx. ${field.maxLength} car.`);
  if (field.minimum !== undefined) parts.push(`≥ ${field.minimum}`);
  if (field.maximum !== undefined) parts.push(`≤ ${field.maximum}`);
  return parts.join(", ") || "—";
}

/**
 * Builds the Markdown description that Postman renders in the
 * request's documentation panel.
 *
 * `base` is what the request already contained (the handler name, or the
 * `summary` of an OpenAPI spec). It is kept at the top: it is something
 * someone intentionally wrote, and replacing it with a generated table
 * would trade information for presentation.
 */
export function buildRequestDescription(
  base: string | undefined,
  fields: ReadonlyArray<IEndpointField> | undefined,
): string {
  const head = (base ?? "").trim();
  if (!fields || fields.length === 0) return head;

  const sections: string[] = [];
  for (const location of LOCATION_ORDER) {
    const group = fields.filter((f) => f.location === location);
    if (group.length === 0) continue;

    const rows = group.map((f) => {
      const required = f.required ? "sí" : "no";
      return `| \`${f.fieldName}\` | ${f.type} | ${required} | ${constraintsOf(f)} |`;
    });
    sections.push(
      [
        `#### ${LOCATION_TITLES[location] ?? location}`,
        "",
        "| Campo | Tipo | Obligatorio | Restricciones |",
        "| --- | --- | :-: | --- |",
        ...rows,
      ].join("\n"),
    );
  }
  if (sections.length === 0) return head;

  // The note at the end is not decorative: without it, the reader cannot tell
  // whether a person wrote it (and it may be stale) or whether it came from the current code.
  return [
    head,
    "",
    ...sections,
    "",
    "_Extraído de las reglas de validación declaradas en el código._",
  ]
    .join("\n")
    .trim();
}
