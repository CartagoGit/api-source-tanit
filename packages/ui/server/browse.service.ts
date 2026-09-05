/**
 * Browsing folders from the UI.
 *
 * Typing the path by hand is where the most mistakes happen: a typo
 * returns "does not exist" and leaves no clue where you were. Being
 * able to move up and down the tree turns that into looking.
 *
 * ## Folders only, never content
 *
 * We return **directory names**. No files, and certainly not their
 * contents. Two reasons, and the second is the one that matters:
 *
 *   · What is being picked here is a folder, and showing thousands of
 *     files from a `node_modules` makes the list useless.
 *   · This is an HTTP server on someone's machine. An endpoint that
 *     returned contents would be an arbitrary file reader, and it
 *     does not matter that it only listens on `127.0.0.1`: the UI
 *     already had a CSRF for trusting that reasoning.
 *
 * ## An unreadable directory does not break navigation
 *
 * It is flagged and we move on. Someone browsing `/` will cross
 * system folders they cannot access, and having the whole list fail
 * for that would make the explorer useless exactly where it is
 * most needed.
 */
import { readdir, stat } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import { homedir } from "node:os";

import type {
  IBrowseEntry,
  IBrowseListing,
} from "../../contracts/interfaces/cli/browse.interface.js";

/**
 * Maximum number of entries returned.
 *
 * A folder with ten thousand subdirectories exists — `/nix/store`, a
 * large `node_modules` — and sending them all turns the response
 * into megabytes that no one will read. We cut it off and say so,
 * which is different from lying about the total.
 */
const MAXIMO = 500;

/** Can it be read, and is it a directory? */
async function esDirectorio(ruta: string): Promise<boolean> {
  try {
    return (await stat(ruta)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where to start when nothing is given.
 *
 * The home folder, not the system root: that is where what someone
 * wants to scan lives, and starting at `/` forces them to navigate
 * five levels down every time.
 */
export function defaultBrowseRoot(): string {
  return homedir();
}

/**
 * Lists the subdirectories of a folder.
 *
 * An empty or non-existent `path` falls back to the home folder
 * instead of failing: whoever opens the explorer for the first time
 * has not picked anything yet, and an error there would be an error
 * for not having done anything.
 */
export async function browseDirectory(path?: string): Promise<IBrowseListing> {
  const pedida = path?.trim();
  const objetivo = pedida ? resolve(pedida) : defaultBrowseRoot();

  if (!(await esDirectorio(objetivo))) {
    return {
      ok: false,
      path: objetivo,
      parent: dirname(objetivo),
      entries: [],
      truncated: false,
      reason: `'${objetivo}' is not a folder, or cannot be opened.`,
    };
  }

  let crudas: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  try {
    crudas = await readdir(objetivo, { withFileTypes: true });
  } catch (error) {
    return {
      ok: false,
      path: objetivo,
      parent: dirname(objetivo),
      entries: [],
      truncated: false,
      reason: `'${objetivo}' could not be read: ${(error as Error).message}`,
    };
  }

  const directorios = crudas
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    // Hidden ones out: whoever needs them can type the path. With
    // them, the home folder starts with thirty configuration entries
    // before the first one someone actually cares about.
    .filter((e) => !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const recortado = directorios.length > MAXIMO;
  const entries: IBrowseEntry[] = [];

  for (const nombre of directorios.slice(0, MAXIMO)) {
    const completa = join(objetivo, nombre);
    entries.push({
      name: nombre,
      path: completa,
      // A link to a file, or to a directory that no longer exists,
      // is flagged unreadable instead of disappearing: seeing it and
      // not being able to enter is understandable; not showing it
      // makes the explorer look broken.
      readable: await esDirectorio(completa),
    });
  }

  // The root has no parent, and returning itself would make the "up"
  // button look broken.
  const raiz = parse(objetivo).root;
  const parent = objetivo === raiz ? null : dirname(objetivo);

  return {
    ok: true,
    path: objetivo,
    parent,
    entries,
    truncated: recortado,
    ...(recortado
      ? {
          reason:
            `Only the first ${MAXIMO} folders are listed, of ${directorios.length}. ` +
            "Type the path directly to reach one that is not here.",
        }
      : {}),
  };
}

/** Path separators, for rendering breadcrumbs. */
export function breadcrumbs(path: string): ReadonlyArray<IBrowseEntry> {
  const absoluta = resolve(path);
  const raiz = parse(absoluta).root;
  const partes = absoluta.slice(raiz.length).split(sep).filter(Boolean);

  const migas: IBrowseEntry[] = [{ name: raiz, path: raiz, readable: true }];
  let acumulada = raiz;
  for (const parte of partes) {
    acumulada = join(acumulada, parte);
    migas.push({ name: parte, path: acumulada, readable: true });
  }
  return migas;
}
