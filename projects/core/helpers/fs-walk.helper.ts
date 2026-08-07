/**
 * Recorrido recursivo de directorios para los scanners.
 *
 * Cuatro scanners repetían la misma llamada a `readdir` con un cast para
 * saltarse los tipos de `Dirent`. Ese cast silencia errores reales, así
 * que el recorrido vive aquí una sola vez y con tipos honestos.
 *
 * El recorrido es **manual**, carpeta a carpeta, y no un
 * `readdir(root, { recursive: true })`. La diferencia importa: la
 * versión recursiva es una única llamada, así que en cuanto algo de
 * dentro falla —un bucle de enlaces simbólicos, una subcarpeta sin
 * permiso— se pierde el recorrido **entero**, incluido lo que ya había
 * encontrado. Medido: un proyecto de Express con un `src/self -> .`
 * devolvía 0 ficheros teniendo el `server.js` al lado, y la colección
 * salía vacía sin decir por qué.
 *
 * Y los bucles no son raros: Capistrano despliega con un `current ->
 * .`, los monorepos enlazan paquetes entre sí, y `node_modules/.bin`
 * está lleno de enlaces.
 *
 * Recorriendo a mano, un directorio problemático solo se pierde a sí
 * mismo. Y se lleva un registro de las rutas reales ya visitadas, que es
 * lo que corta los ciclos.
 */
import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

/** Entrada de directorio. */
interface IDirentLike {
  readonly name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** Directorios que nunca contienen código del proyecto escaneado. */
const ALWAYS_SKIPPED = new Set([
  "node_modules",
  ".git",
  "vendor",
  "__pycache__",
  "dist",
  "build",
  ".venv",
  "venv",
  ".cache",
]);

/**
 * Profundidad máxima. Un proyecto real no anida 40 niveles de código;
 * si se llega aquí es que algo va mal, y es preferible parar a recorrer
 * el disco entero.
 */
const MAX_DEPTH = 40;

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
 * Nunca lanza. Un directorio ilegible o un ciclo de enlaces se saltan y
 * el resto del árbol se recorre igual — que es lo que esta función
 * prometía y no cumplía.
 */
export async function collectFiles(
  root: string,
  matches: (fileName: string) => boolean,
  options: ICollectFilesOptions = {},
): Promise<string[]> {
  const skipVendor = options.skipVendorDirs !== false;
  const out: string[] = [];
  /** Rutas reales ya visitadas: es lo que corta los ciclos. */
  const visited = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;

    // `realpath` resuelve los enlaces: dos rutas distintas que apuntan
    // al mismo sitio se visitan una sola vez.
    let real: string;
    try {
      real = await realpath(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);

    let entries: IDirentLike[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Sin permiso, o desapareció mientras recorríamos. Se pierde esta
      // carpeta y solo esta.
      return;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (skipVendor && ALWAYS_SKIPPED.has(entry.name)) continue;
        await walk(full, depth + 1);
        continue;
      }

      if (entry.isFile()) {
        if (matches(entry.name)) out.push(full);
        continue;
      }

      // Un enlace simbólico no es ni fichero ni directorio para
      // `Dirent`: hay que resolverlo. Los proyectos enlazan código con
      // más frecuencia de la que parece, y saltárselos dejaba fuera
      // ficheros que sí cuentan.
      if (entry.isSymbolicLink()) {
        try {
          const target = await realpath(full);
          const targetEntries = await readdir(target, { withFileTypes: true }).then(
            () => true,
            () => false,
          );
          if (targetEntries) {
            if (skipVendor && ALWAYS_SKIPPED.has(entry.name)) continue;
            await walk(full, depth + 1);
          } else if (matches(entry.name) && !visited.has(target)) {
            visited.add(target);
            out.push(full);
          }
        } catch {
          // Enlace roto: se ignora.
        }
      }
    }
  }

  await walk(root, 0);
  return out;
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
