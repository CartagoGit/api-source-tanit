/**
 * Recorrido recursivo de directorios para los scanners.
 *
 * Cuatro scanners repetían la misma llamada a
 * `readdir(dir, { recursive: true, withFileTypes: true })` seguida de un
 * `as unknown as Array<{ name; isFile(); parentPath }>` para saltarse los
 * tipos de `Dirent`. Ese cast silencia errores reales (uno de ellos
 * llevaba tiempo rompiendo `tsc --noEmit`), así que el recorrido vive
 * aquí una sola vez y con tipos honestos.
 *
 * `parentPath` sustituyó a `path` en Node 20.12 / 21.4. Se leen ambos
 * para funcionar en cualquiera de las versiones soportadas.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Entrada de directorio, normalizada entre versiones de Node. */
interface IDirentLike {
  readonly name: string;
  isFile(): boolean;
  readonly parentPath?: string;
  readonly path?: string;
}

/** Directorios que nunca contienen código del proyecto escaneado. */
const ALWAYS_SKIPPED = ["node_modules", ".git", "vendor", "__pycache__", "dist", "build"];

/** Ajustes opcionales del recorrido. */
export interface ICollectFilesOptions {
  /**
   * Si `false`, no se saltan `node_modules`, `.git`, `vendor`… Por
   * defecto se saltan: escanear dependencias de terceros produce ruido
   * (y en el caso del lint de tools, infracciones ajenas).
   */
  readonly skipVendorDirs?: boolean;
}

/**
 * Rutas absolutas de todos los ficheros bajo `root` (recursivo) cuyo
 * nombre pasa el filtro.
 *
 * Nunca lanza: un directorio ilegible devuelve lista vacía, porque un
 * permiso denegado en una subcarpeta no debe abortar el escaneo entero.
 */
export async function collectFiles(
  root: string,
  matches: (fileName: string) => boolean,
  options: ICollectFilesOptions = {},
): Promise<string[]> {
  let entries: IDirentLike[];
  try {
    entries = (await readdir(root, {
      recursive: true,
      withFileTypes: true,
    })) as unknown as IDirentLike[];
  } catch {
    return [];
  }

  const skipVendor = options.skipVendorDirs !== false;
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!matches(entry.name)) continue;
    const parent = entry.parentPath ?? entry.path ?? root;
    if (skipVendor && isInsideVendorDir(parent)) continue;
    out.push(join(parent, entry.name));
  }
  return out;
}

function isInsideVendorDir(dir: string): boolean {
  const segments = dir.split(/[\\/]/);
  return segments.some((s) => ALWAYS_SKIPPED.includes(s));
}

/**
 * Igual que `collectFiles` sobre varias raíces, sin repetidos y
 * saltándose las que no existen.
 */
export async function collectFilesFrom(
  roots: ReadonlyArray<string>,
  matches: (fileName: string) => boolean,
  options: ICollectFilesOptions = {},
): Promise<string[]> {
  const seen = new Set<string>();
  for (const root of roots) {
    for (const file of await collectFiles(root, matches, options)) seen.add(file);
  }
  return [...seen];
}

/** Filtro reutilizable: ficheros de código fuente JS/TS, sin tests ni .d.ts. */
export function isSourceJsTsFile(name: string): boolean {
  if (!/\.(ts|js|mjs|cjs|tsx|jsx)$/.test(name)) return false;
  if (name.endsWith(".d.ts")) return false;
  if (name.includes(".test.") || name.includes(".spec.")) return false;
  return name !== "vite.config.ts" && name !== "vitest.config.ts";
}
