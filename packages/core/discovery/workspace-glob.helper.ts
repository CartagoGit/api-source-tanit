/**
 * Resolver de globs de workspaces — a00012 S1.a.
 *
 * Helper **puro** (sin estado de instancia, sin `process.cwd()`): toma
 * los globs que salen del parser de `package.json`, `turbo.json`,
 * `lerna.json` o `pnpm-workspace.yaml` y los convierte en las
 * carpetas reales bajo `projectRoot`.
 *
 * ## Por qué hace falta
 *
 * La versión anterior (`resolveWorkspaceDirs`, dentro de
 * `monorepo-detector.helper.ts`) partía el glob por el primer `*` y
 * devolvía el prefijo: `apps/*` → `apps`, no `apps/api` ni
 * `apps/web`. Eso significaba que el orquestador recibía el
 * contenedor y tenía que re-enumerar dentro, perdiendo precisión
 * cuando el prefijo era un wildcard con muchos hijos y
 * `frameworkSearchRoot` nunca podía inferirse correctamente.
 *
 * ## Comportamiento
 *
 * - **Sin meta-caracteres** (`*`, `?`, `**`, `{...}`): se trata como
 *   literal. Se mira `statSync` y se devuelve el path relativo POSIX
 *   si existe dentro de `projectRoot`.
 * - **Con `*` o `?` pero sin `**`**: enumera los descendientes
 *   directos del prefijo (`apps/*` → hijos de `apps`) y filtra con un
 *   regex que convierte `*` → `[^/]*`, `?` → `[^/]` y `**` → `.*`.
 *   Solo directorios.
 * - **Con `**`**: enumera recursivamente los descendientes del
 *   prefijo.
 * - **Exclusiones (`!apps/test`)**: se quitan del resultado final.
 *   Si una inclusión y una exclusión matchean el mismo path, la
 *   exclusión gana. Las exclusiones se resuelven por el mismo camino
 *   que las inclusiones (también pueden ser globs).
 * - **Normalización**: rechaza absolutos, vacíos y escapes fuera de
 *   `projectRoot` antes de tocar el disco. Los resultados siempre
 *   son POSIX relativo, sin `./`, sin absolutos, sin `..`.
 * - **Determinismo**: los paths se ordenan lexicográficamente y se
 *   deduplican. Dos invocaciones idénticas producen el mismo output
 *   en el mismo orden.
 * - **I/O silenciosa**: si un prefijo no es un directorio (no
 *   existe, es archivo, falta permiso), se ignora en silencio y se
 *   continúa.
 *
 * ## Sin dependencias externas
 *
 * El proyecto no requiere npm packages para este resolver; `@types/node`
 * no está en `dependencies` y `bun-types` no aporta matchers POSIX.
 * El recorrido se hace con `node:fs` síncrono (es boot-time / una vez
 * por escaneo, no hot path) y el matching es un regex ASCII construido
 * a mano.
 */
import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

/**
 * Materializa una lista de globs de workspaces en directorios reales.
 *
 * @param projectRoot Raíz absoluta del proyecto (los callers ya la
 *   absolutizaron fuera de este helper).
 * @param globs Globs en formato POSIX relativo, posiblemente
 *   prefijados con `!` para excluirlos.
 * @returns Directorios existentes bajo `projectRoot`, en formato
 *   POSIX relativo, ordenados lexicográficamente y deduplicados.
 *   Una ruta raíz inválida devuelve `[]`.
 */
export async function resolveWorkspaceGlobs(
  projectRoot: string,
  globs: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  if (!projectRoot || !isAbsolute(projectRoot)) return [];

  const included = new Set<string>();
  const excluded = new Set<string>();

  for (const raw of globs) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    const isExclusion = trimmed.startsWith("!");
    const stripped = isExclusion ? trimmed.slice(1).trim() : trimmed;
    if (stripped.length === 0) continue;

    // Normalizamos siempre: el parser ya normaliza, pero este helper
    // también rechaza absolutos y escapes como contrato público.
    const normalized = normalizePosixRelative(stripped);
    if (!normalized) continue;

    const resolved = resolveSingleGlob(projectRoot, normalized);
    const bucket = isExclusion ? excluded : included;
    for (const dir of resolved) bucket.add(dir);
  }

  const merged: string[] = [];
  for (const dir of included) {
    if (!excluded.has(dir)) merged.push(dir);
  }
  merged.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return merged;
}

/**
 * Resuelve un único glob ya normalizado a sus directorios reales.
 * Es la bifurcación entre literales y patrones.
 */
function resolveSingleGlob(
  projectRoot: string,
  glob: string,
): ReadonlyArray<string> {
  if (!hasMeta(glob)) return resolveLiteral(projectRoot, glob);
  return resolvePattern(projectRoot, glob);
}

/** Literal: `existsSync` y POSIX relativo. */
function resolveLiteral(
  projectRoot: string,
  relPath: string,
): ReadonlyArray<string> {
  const absolute = join(projectRoot, relPath);
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];

  const rel = toPosixRelative(projectRoot, absolute);
  if (!isInsideProjectRoot(rel)) return [];
  return [rel];
}

/**
 * Patrón: enumera el prefijo y filtra con regex.
 *
 * El "prefijo" es todo lo anterior al primer meta-carácter
 * (`*`, `?`, `{`). Si el prefijo no existe o no es directorio, se
 * devuelve `[]` sin error. El `**` controla la profundidad: si está
 * presente, se enumeran todos los descendientes; si no, solo los
 * hijos directos.
 */
function resolvePattern(
  projectRoot: string,
  glob: string,
): ReadonlyArray<string> {
  const prefix = globPrefix(glob);
  const absolutePrefix = join(projectRoot, prefix);

  let stat;
  try {
    stat = statSync(absolutePrefix);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];

  const recursive = glob.indexOf("**") !== -1;
  const candidates = recursive
    ? enumerateRecursive(absolutePrefix)
    : enumerateOneLevel(absolutePrefix);

  const regex = globToRegExp(glob);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const rel = toPosixRelative(projectRoot, candidate);
    if (!isInsideProjectRoot(rel)) continue;
    if (!regex.test(rel)) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

/** Prefijo de un glob (todo lo anterior al primer meta-carácter). */
function globPrefix(glob: string): string {
  const match = /^([^*?{]*)/.exec(glob);
  const prefix = match?.[1] ?? "";
  // Quitar un `/` final para que `join` no introduzca un separador
  // vacío cuando el prefijo es exactamente el directorio padre.
  return prefix.replace(/\/$/, "");
}

/** ¿Este glob tiene meta-caracteres que requieren expansión? */
function hasMeta(glob: string): boolean {
  return /[*?{]/.test(glob);
}

/** Hijos directos del directorio que sean directorios. */
function enumerateOneLevel(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) out.push(join(dir, entry.name));
  }
  return out;
}

/** Descendientes recursivos del directorio (excluye el propio directorio). */
function enumerateRecursive(rootDir: string): string[] {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      out.push(join(current, entry.name));
      stack.push(join(current, entry.name));
    }
  }
  return out;
}

/**
 * Convierte un glob POSIX relativo en un regex anclado.
 *
 * Reglas (todas ASCII):
 *  - `**` → `.*` (matchea `/` también)
 *  - `*` → `[^/]*` (no matchea `/`)
 *  - `?` → `[^/]` (un solo carácter, no `/`)
 *  - Otros caracteres regex (`.+(){}|^$[]\`) se escapan.
 *
 * No soportamos `{a,b}` (brace expansion) más allá de escapar las
 * llaves: los configs reales de workspaces no las usan dentro de la
 * parte dinámica.
 */
function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === "*" && glob[i + 1] === "*") {
      // `**` puede ir seguido o no de `/`.
      pattern += ".*";
      i += 2;
      if (glob[i] === "/") i++;
      continue;
    }
    if (ch === "*") {
      pattern += "[^/]*";
      i++;
      continue;
    }
    if (ch === "?") {
      pattern += "[^/]";
      i++;
      continue;
    }
    if (/[.+(){}|^$\[\]\\]/.test(ch)) {
      pattern += "\\" + ch;
      i++;
      continue;
    }
    pattern += ch;
    i++;
  }
  pattern += "$";
  return new RegExp(pattern);
}

/**
 * Normaliza un glob/ruta a formato POSIX relativo, rechazando
 * escapes y absolutos. Si la entrada colapsa a algo que escapa de
 * la raíz (`..` al principio) o a vacío, se devuelve `null`.
 *
 * Acepta:
 *  - `apps/api`
 *  - `./apps/api` (se quita el `./`)
 *  - `apps/../api` → `api`
 *
 * Rechaza:
 *  - `` (vacío) y `.`
 *  - `/abs/path`
 *  - `apps/../../etc` (escapa)
 */
function normalizePosixRelative(value: string): string | null {
  let cleaned = value.trim().replace(/\\/g, "/");
  if (cleaned.startsWith("./")) cleaned = cleaned.slice(2);
  if (cleaned.length === 0 || cleaned === ".") return null;
  if (cleaned.startsWith("/")) return null;

  const segments = cleaned.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else {
        out.push("..");
      }
      continue;
    }
    out.push(segment);
  }

  if (out.length === 0) return null;
  if (out[0] === "..") return null;
  return out.join("/");
}

/** Convierte un path absoluto en su forma POSIX relativa a `projectRoot`. */
function toPosixRelative(projectRoot: string, absolute: string): string {
  const rel = relative(projectRoot, absolute);
  return rel.split(sep).join("/");
}

/**
 * ¿Este path relativo cae dentro de `projectRoot` sin escapar?
 *
 * Se considera "dentro" un path no vacío, no absoluto, sin `..` y
 * distinto de `.`. La normalización ya colapsa `..` previos; si
 * aparece un `..` en el resultado, significa que escapó.
 */
function isInsideProjectRoot(relPath: string): boolean {
  if (relPath.length === 0 || relPath === ".") return false;
  if (isAbsolute(relPath)) return false;
  if (relPath.includes("..")) return false;
  return true;
}
