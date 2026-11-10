/**
 * Writing a project snapshot to disk, and reading it back.
 *
 * ## Why not `JSON.stringify`
 *
 * Because a snapshot is not only JSON. The schema graph is a `Map`,
 * the capture time is a `Date`, and `JSON.stringify` turns a `Map`
 * into `{}` — **silently**, with no error and no warning.
 *
 * That matters because the OpenAPI exporter reads
 * `spec.schemaGraph.nodes`: a snapshot written that way comes back
 * **without schemas**. The re-exported file would look right and be
 * wrong, which is the worst kind of wrong — and it would only be
 * wrong for the format whose whole job is the schemas.
 *
 * So the codec marks what JSON cannot express:
 *
 *   · a `Map` becomes `{"$map": [[key, value], …]}`;
 *   · a `Date` becomes `{"$date": "…"}`.
 *
 * Everything else is plain JSON, and the decoded value is the value
 * that was encoded.
 */

/** The key that marks an encoded `Map`. */
const MAP_TAG = "$map";

/** The key that marks an encoded `Date`. */
const DATE_TAG = "$date";

/** Encodes one value, marking what JSON cannot express. */
function encodeValue(value: unknown): unknown {
  if (value instanceof Date) return { [DATE_TAG]: value.toISOString() };
  if (value instanceof Map) {
    return {
      [MAP_TAG]: [...value.entries()].map(([key, entry]) => [
        encodeValue(key),
        encodeValue(entry),
      ]),
    };
  }
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        encodeValue(entry),
      ]),
    );
  }
  return value;
}

/**
 * Decodes one value, restoring what the encoder marked.
 *
 * A plain object that happens to have a `$map` key is **not** a map:
 * the tag only counts when it is the object's only key. Anything else
 * is data, and data is not reinterpreted.
 */
function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value === null || typeof value !== "object") return value;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 1) {
    const [key, inner] = entries[0] ?? [];
    if (key === DATE_TAG && typeof inner === "string") return new Date(inner);
    if (key === MAP_TAG && Array.isArray(inner)) {
      return new Map(
        inner.map(([mapKey, mapValue]) => [decodeValue(mapKey), decodeValue(mapValue)]),
      );
    }
  }
  return Object.fromEntries(
    entries.map(([key, entry]) => [key, decodeValue(entry)]),
  );
}

/**
 * Encodes a snapshot as JSON.
 *
 * @param snapshot The snapshot to encode.
 * @returns The JSON text.
 */
export function encodeSnapshot(snapshot: unknown): string {
  return JSON.stringify(encodeValue(snapshot));
}

/**
 * Decodes a snapshot from JSON.
 *
 * @param json The JSON text.
 * @returns The value that was encoded.
 * @throws When the text is not JSON: a file that cannot be read is
 * not a snapshot that is empty.
 */
export function decodeSnapshot(json: string): unknown {
  return decodeValue(JSON.parse(json));
}
