/**
 * YAML serializer for flat data.
 *
 * Written by hand and not using a library because the compiled binary
 * cannot load packages at runtime, and shipping a whole YAML emitter
 * for a single artifact is not worth it.
 *
 * **The rule that makes it safe: every string goes between double quotes.**
 *
 * That is the entire point of this file. YAML has plain-scalar rules
 * with which it is extremely easy to corrupt a document without warning:
 *
 * | Written without quotes | What YAML understands |
 * | --- | --- |
 * | `yes` / `on` / `y` | boolean `true` (YAML 1.1) |
 * | `no` / `off` | boolean `false` |
 * | `null` / `~` / (empty) | null |
 * | `1.0` | number, not the string "1.0" |
 * | `08` | in some implementations, invalid octal |
 * | `hola: mundo` | two nested keys |
 * | `#comentario` | comment, the value is lost |
 *
 * An endpoint description that says "no" would end up as `false`. By
 * quoting **always**, none of those rules apply: a string between
 * double quotes is a string, period.
 *
 * Real numbers and booleans do go without quotes — they are numbers and
 * booleans in the source data, and quoting them would turn them into
 * text.
 *
 * YAML's escaping for double quotes is **the same as JSON's**, so it
 * is delegated to `JSON.stringify` instead of being reimplemented: that
 * is the place where a hand-rolled bug would be the hardest to spot.
 */
import type { YamlValue } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * Keys that may go without quotes.
 *
 * Deliberately narrow: identifiers only. OpenAPI keys include
 * `/api/users`, `200`, and `application/json`, and all three must be
 * quoted.
 */
const PLAIN_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Words that YAML interprets even though they look like identifiers. */
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
    // `NaN` and `Infinity` are not valid YAML in most consumers;
    // emit them as null, which is.
    return Number.isFinite(value) ? String(value) : "null";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  // The rule of the file: always between quotes.
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
      // A compound item: the `- ` sticks to its first line and the rest
      // is indented one level deeper.
      const inner = emit(item, indent + 1);
      const first = inner[0] ?? "";
      lines.push(`${pad}- ${first.slice((indent + 1) * 2)}`);
      lines.push(...inner.slice(1));
    }
    return lines;
  }

  // The type predicate is not decoration: without it, `item` still
  // admits `undefined` further down, and the `Object.keys` of the empty
  // object branch would not compile.
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
    // Sequences are indented at the same level as their key, which is
    // what everyone does and what YAML allows.
    lines.push(...emit(item, Array.isArray(item) ? indent : indent + 1));
  }
  return lines;
}

/** Serializes a value to YAML. Ends with a newline. */
export function toYaml(value: YamlValue): string {
  return emit(value, 0).join("\n") + "\n";
}
