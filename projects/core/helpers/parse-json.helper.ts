/**
 * Parsear JSON ajeno sin que `any` se cuele en el resto del programa.
 *
 * Los scanners leen manifiestos y specs **de otra gente**: entrada no
 * controlada. El patrón que había era siempre el mismo —
 * `let parsed: any; try { parsed = JSON.parse(raw) } catch {}` — y a
 * partir de ahí `any` viajaba por medio scanner sin que el compilador
 * pudiera decir nada.
 *
 * No es teórico: `__params` entró exactamente por un punto donde el tipo
 * dejaba de describir lo que circulaba.
 *
 * `unknown` obliga a preguntar antes de usar, que es justo lo que hay
 * que hacer con un fichero que ha escrito otro. Los predicados de abajo
 * son las preguntas que los scanners repetían a mano, cada uno a su
 * manera.
 */
import type { JsonRead } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * Parsea, distinguiendo "no se pudo" de "parseó a `null`".
 *
 * Los dos casos se confundían: `JSON.parse("null")` devuelve `null`, y
 * un `catch` que también deja `null` hace que un fichero corrupto y uno
 * que legítimamente contiene `null` acaben iguales. Solo uno de los dos
 * merece un aviso.
 */
export function parseJson(raw: string): JsonRead {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

/** ¿Es un objeto con claves, y no `null` ni un array? */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** El valor de una clave, si es un objeto. */
export function readObject(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[key];
  return isRecord(found) ? found : undefined;
}

/** El valor de una clave, si es una cadena no vacía. */
export function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[key];
  return typeof found === "string" && found.length > 0 ? found : undefined;
}

/** El valor de una clave, si es un array. */
export function readArray(value: unknown, key: string): unknown[] | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[key];
  return Array.isArray(found) ? found : undefined;
}

/**
 * Las dependencias declaradas en un `package.json`, fundidas.
 *
 * `dependencies` y `devDependencies` juntas, porque la pregunta que los
 * scanners hacen es «¿este proyecto usa X?» y un framework en
 * `devDependencies` sigue siendo el framework del proyecto. Unos
 * scanners las miraban y otros no, así que el mismo proyecto se
 * detectaba o no según cuál preguntara.
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
