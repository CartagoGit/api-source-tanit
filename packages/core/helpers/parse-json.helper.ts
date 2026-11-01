/**
 * Parse third-party JSON without `any` leaking into the rest of the program.
 *
 * The scanners read manifests and specs **written by someone else**:
 * uncontrolled input. The pattern that was there was always the same —
 * `let parsed: any; try { parsed = JSON.parse(raw) } catch {}` — and
 * from there `any` traveled through half the scanner without the compiler
 * being able to say anything.
 *
 * It's not theoretical: `__params` entered exactly through a point where
 * the type stopped describing what was circulating.
 *
 * `unknown` forces you to ask before using, which is exactly what you
 * have to do with a file written by someone else. The predicates below
 * are the questions the scanners kept asking by hand, each in its own way.
 */
import type { JsonRead } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * Parse, distinguishing "couldn't parse" from "parsed to `null`".
 *
 * The two cases got confused: `JSON.parse("null")` returns `null`, and a
 * `catch` that also leaves `null` makes a corrupt file and one that
 * legitimately contains `null` end up identical. Only one of them
 * deserves a warning.
 */
export function parseJson(raw: string): JsonRead {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

/** Is it an object with keys, and not `null` or an array? */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value of a key, if it's an object. */
export function readObject(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[key];
  return isRecord(found) ? found : undefined;
}

/** The value of a key, if it's a non-empty string. */
export function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[key];
  return typeof found === "string" && found.length > 0 ? found : undefined;
}

/** The value of a key, if it's an array. */
export function readArray(value: unknown, key: string): unknown[] | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[key];
  return Array.isArray(found) ? found : undefined;
}

/**
 * The dependencies declared in a `package.json`, merged.
 *
 * `dependencies` and `devDependencies` together, because the question
 * the scanners ask is "does this project use X?" and a framework in
 * `devDependencies` is still the project's framework. Some scanners
 * looked at them and others didn't, so the same project was detected or
 * not depending on which one was asking.
 */
export function declaredDependencies(pkg: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const block = readObject(pkg, key);
    if (!block) continue;
    for (const [name, version] of Object.entries(block)) {
      if (typeof version === "string") out[name] ??= version;
    }
  }
  return out;
}
