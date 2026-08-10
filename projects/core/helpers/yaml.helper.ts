/**
 * Serializador a YAML para datos planos.
 *
 * Se escribió a mano y no se usa una librería porque el binario
 * compilado no puede cargar paquetes en tiempo de ejecución, y meter un
 * emisor de YAML entero por un solo artefacto no compensa.
 *
 * **La regla que lo hace seguro: toda cadena va entre comillas dobles.**
 *
 * Ese es el punto entero de este fichero. YAML tiene reglas de escalares
 * planos con las que es facilísimo corromper un documento sin que nada
 * avise:
 *
 * | Escrito sin comillas | Lo que YAML entiende |
 * | --- | --- |
 * | `sí` / `yes` / `on` | booleano `true` (YAML 1.1) |
 * | `no` / `off` | booleano `false` |
 * | `null` / `~` / (vacío) | nulo |
 * | `1.0` | número, no la cadena "1.0" |
 * | `08` | en algunas implementaciones, octal inválido |
 * | `hola: mundo` | dos claves anidadas |
 * | `#comentario` | comentario, se pierde el valor |
 *
 * Una descripción de un endpoint que diga "no" acabaría siendo `false`.
 * Citando **siempre**, ninguna de esas reglas se aplica: una cadena entre
 * comillas dobles es una cadena y punto.
 *
 * Los números y booleanos de verdad sí van sin comillas — son números y
 * booleanos en el dato de origen, y citarlos los convertiría en texto.
 *
 * El escapado de las comillas dobles de YAML es **el mismo que el de
 * JSON**, así que se delega en `JSON.stringify` en vez de reimplementarlo:
 * es la parte donde un fallo propio sería más difícil de ver.
 */
import type { YamlValue } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * Claves que pueden ir sin comillas.
 *
 * Deliberadamente estrecho: solo identificadores. Las claves de OpenAPI
 * incluyen `/api/users`, `200` y `application/json`, y las tres tienen
 * que ir citadas.
 */
const PLAIN_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Palabras que YAML interpreta aunque parezcan identificadores. */
const RESERVED_PLAIN = new Set([
  "true",
  "false",
  "null",
  "yes",
  "no",
  "on",
  "off",
  "y",
  "n",
]);

function formatKey(key: string): string {
  if (PLAIN_KEY_RE.test(key) && !RESERVED_PLAIN.has(key.toLowerCase())) return key;
  return JSON.stringify(key);
}

function formatScalar(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    // `NaN` e `Infinity` no son YAML válido en la mayoría de los
    // consumidores; se emiten como nulo, que sí lo es.
    return Number.isFinite(value) ? String(value) : "null";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  // La regla del fichero: siempre entre comillas.
  return JSON.stringify(value);
}

function isScalar(value: YamlValue): value is string | number | boolean | null {
  return value === null || typeof value !== "object";
}

function emit(value: YamlValue, indent: number): string[] {
  const pad = "  ".repeat(indent);

  if (value === undefined) return [`${pad}null`];
  if (isScalar(value)) return [`${pad}${formatScalar(value)}`];

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    const lines: string[] = [];
    for (const item of value) {
      if (isScalar(item) || item === undefined) {
        lines.push(`${pad}- ${formatScalar(item ?? null)}`);
        continue;
      }
      // Un elemento compuesto: el `- ` va pegado a su primera línea y el
      // resto se sangra un nivel más.
      const inner = emit(item, indent + 1);
      const first = inner[0] ?? "";
      lines.push(`${pad}- ${first.slice((indent + 1) * 2)}`);
      lines.push(...inner.slice(1));
    }
    return lines;
  }

  // El predicado de tipo no es adorno: sin él, `item` sigue admitiendo
  // `undefined` más abajo y el `Object.keys` de la rama del objeto vacío
  // no compila.
  const entries = Object.entries(value).filter(
    (entry): entry is [string, Exclude<YamlValue, undefined>] => entry[1] !== undefined,
  );
  if (entries.length === 0) return [`${pad}{}`];

  const lines: string[] = [];
  for (const [key, item] of entries) {
    const name = formatKey(key);
    if (isScalar(item)) {
      lines.push(`${pad}${name}: ${formatScalar(item)}`);
      continue;
    }
    if (Array.isArray(item) && item.length === 0) {
      lines.push(`${pad}${name}: []`);
      continue;
    }
    if (!Array.isArray(item) && Object.keys(item).length === 0) {
      lines.push(`${pad}${name}: {}`);
      continue;
    }
    lines.push(`${pad}${name}:`);
    // Las secuencias se sangran al mismo nivel que su clave, que es lo
    // que hace todo el mundo y lo que YAML permite.
    lines.push(...emit(item, Array.isArray(item) ? indent : indent + 1));
  }
  return lines;
}

/** Serializa un valor a YAML. Termina en salto de línea. */
export function toYaml(value: YamlValue): string {
  return emit(value, 0).join("\n") + "\n";
}
