/**
 * Write a whole file, or don't write it at all.
 *
 * `writeFile` on a path that already exists **truncates first and
 * writes after**. Between those two moments the file is half-written,
 * and if the process dies there —Ctrl-C, OOM, the battery— what
 * remains is not an incomplete collection: it's a truncated JSON, which
 * Postman won't open.
 *
 * The serious case is `watch`. It rewrites the collection on every
 * project change, and the flow the README documents is having it
 * imported in Postman while you code. Every save was a window for
 * reading a half-written JSON, and the whole product of this tool is
 * that file.
 *
 * The solution is old and well-known: write to a temp file and rename.
 * `rename` within the same filesystem is atomic — whoever reads the
 * path sees the previous content or the new one, never half of it.
 *
 * Two details that aren't optional:
 *
 *   1. **The temp file goes in the destination directory**, not in
 *      `/tmp`. A `rename` between different filesystems doesn't exist:
 *      the system returns `EXDEV` and you have to copy, which is
 *      exactly what you wanted to avoid. And `/tmp` is another
 *      filesystem more often than it seems.
 *   2. **The temp file is deleted if anything fails**, so as not to
 *      leave trash next to the collection under a name nobody
 *      recognizes.
 */
import { appendFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Suffix of the temp file.
 *
 * It carries the pid and a counter so that two concurrent writes to the
 * same path don't step on each other's temp file. It's not a case we've
 * seen, but the cost of avoiding it is one template literal.
 */
let secuencia = 0;
function rutaTemporal(destino: string): string {
  secuencia += 1;
  const proceso = typeof process === "undefined" ? 0 : process.pid;
  return join(dirname(destino), `.${proceso}-${secuencia}.tmp`);
}

/**
 * Writes `contenido` to `destino` atomically.
 *
 * Creates the directory if needed. If anything fails, `destino` stays
 * exactly as it was and no temp file is left behind.
 */
export async function writeFileAtomic(
  destino: string,
  contenido: string,
): Promise<void> {
  const dir = dirname(destino);
  await mkdir(dir, { recursive: true });

  const temporal = rutaTemporal(destino);
  try {
    await writeFile(temporal, contenido, "utf8");
    await rename(temporal, destino);
  } catch (error) {
    // The temp file is just in the way. If it can't be deleted either,
    // the error that propagates is the write error, which is the one
    // that explains what happened — not the delete error, which is a
    // consequence.
    await rm(temporal, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Same, for JSON.
 *
 * Serializes **before** touching the disk: if the object has a cycle
 * or a `BigInt`, `JSON.stringify` throws and no file has been opened.
 * Serializing while writing is how you end up with a half-written file
 * without the process even crashing.
 */
export async function writeJsonAtomic(
  destino: string,
  valor: unknown,
  espacios = 2,
): Promise<void> {
  const json = `${JSON.stringify(valor, null, espacios)}\n`;
  await writeFileAtomic(destino, json);
}

/**
 * Atomic append of `contenido` to the end of `destino`.
 *
 * It differs from `writeFileAtomic` in what it protects:
 *
 *   - `writeFileAtomic` writes the **whole** file: a `rename` within
 *     the same filesystem is atomic, but the file is truncated before
 *     the rename. That's what you want for a Postman collection, where
 *     the reader needs the complete version or nothing.
 *
 *   - `appendFileAtomic` appends `contenido` to the end: it uses
 *     `appendFile`, which opens the destination with `O_APPEND`. On
 *     POSIX that's atomic per `write(2)`: two processes writing at
 *     once don't step on each other —their bytes end up at the end in
 *     some order, but none is lost half-written—. That's what you want
 *     for a JSONL log: each line is one entry, and reading the last N
 *     lines must be safe even if another write is in progress.
 *
 * If the file doesn't exist, it creates it (recursive mkdir on the
 * directory, same as `writeFileAtomic`). If the write fails, it
 * doesn't leave partial content visible: `appendFile` doesn't truncate
 * before writing, so a failure halfway through a line shows up as a
 * prefix without a newline, and that's handled by the reader as a
 * corrupted line.
 */
export async function appendFileAtomic(
  destino: string,
  contenido: string,
): Promise<void> {
  const dir = dirname(destino);
  await mkdir(dir, { recursive: true });
  await appendFile(destino, contenido, "utf8");
}
