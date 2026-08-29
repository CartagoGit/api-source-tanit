/**
 * La descripción de una request: qué acepta el endpoint, en una tabla.
 *
 * El body de ejemplo enseña **un** valor válido. Eso no es lo mismo que
 * decir cuáles son válidos: un `"age": 30` no cuenta que el máximo son
 * 120, ni que el campo es opcional, ni que `role` solo admite tres
 * valores. Toda esa información **ya se ha extraído** del código fuente
 * para poder construir el ejemplo, y se estaba tirando.
 *
 * Lo que se documenta es lo que el endpoint **recibe**, que es lo que
 * este proyecto escanea. Lo que devuelve no se sabe, y por eso no hay
 * respuestas de ejemplo: ver la nota de p00031 sobre por qué inventarlas
 * habría sido peor que no tenerlas.
 */
import type { IEndpointField } from "../../contracts/interfaces/core/postman.interface.js";

/** Los sitios donde puede ir un parámetro, y cómo llamarlos. */
const LOCATION_TITLES: Readonly<Record<string, string>> = {
  body: "Body",
  query: "Query",
  path: "Path",
  header: "Headers",
  cookie: "Cookies",
};

/** El orden en que se presentan: de lo más a lo menos habitual. */
const LOCATION_ORDER = ["body", "query", "path", "header", "cookie"] as const;

/** Las restricciones de un campo, en una celda. */
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
 * Construye la descripción en Markdown, que es lo que Postman renderiza
 * en el panel de documentación de la request.
 *
 * `base` es lo que ya traía la request (el nombre del handler, o el
 * `summary` de un spec OpenAPI). Se conserva arriba: es lo que alguien
 * escribió a propósito, y pisarlo con una tabla generada sería cambiar
 * información por presentación.
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

  // La nota del final no es decorativa: sin ella, quien lee la tabla no
  // sabe si la escribió una persona (y puede estar vieja) o si sale del
  // código de ahora mismo.
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
