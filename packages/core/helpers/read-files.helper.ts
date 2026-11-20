/**
 * Read many files without reading them one at a time.
 *
 * The eighteen scanners all do the same thing: they collect the paths
 * they care about and then walk the list with `await readFile(f)`
 * inside the loop. That is one read **at a time**, waiting for the disk
 * to answer before asking for the next, while the kernel can serve
 * several at once without breaking a sweat.
 *
 * Measured on a synthetic project of 1000 files:
 *
 * | Approach | Time |
 * | --- | --: |
 * | One at a time (what there was) | 131 ms |
 * | With a cap of 16 in flight | 14 ms |
 *
 * Nine and a half times. That said, so nobody is disappointed: the read
 * is **19%** of the pipeline on that project, so the total drops from
 * ~746 ms to ~630 ms. The rest is parsing, and there is no disk that
 * helps there. The measurement is in `bench-scan.script.ts` so the next
 * performance claim also comes out of a number.
 *
 * Three things this function respects on purpose:
 *
 *   1. **Input order.** The scanners build the collection by walking
 *      files, and if the order shifted between runs the collection would
 *      come out different each time. Read in parallel, delivered in
 *      order.
 *   2. **Bounded memory.** It is a generator with a sliding window, not
 *      a `Promise.all` over the whole list: at most `limit` files are
 *      in flight, not ten thousand.
 *   3. **An unreadable file does not crash the scan.** It is skipped,
 *      just like each scanner was doing with its own `try/catch`.
 */
import { readFile } from "node:fs/promises";
import type { IReadFile } from "../../contracts/interfaces/core/helpers.interface.js";
import { READ_CONCURRENCY } from "../../contracts/constants/core/runtime-limits.constant.js";

/** A single file read. */

async function readOne(path: string): Promise<IReadFile | null> {
  try {
    return { path, text: await readFile(path, "utf8") };
  } catch {
    // Permisos, un enlace roto, un fichero que desaparece a mitad del
    // escaneo. Ninguno es motivo para no leer los otros novecientos.
    return null;
  }
}

/**
 * Reads `paths` in parallel (with a cap) and yields them **in input
 * order**.
 *
 * Those that cannot be read do not appear, without warning: it is what
 * each scanner was already doing on its own.
 *
 * ```ts
 * for await (const { path, text } of readFilesInOrder(files)) {
 *   // …
 * }
 * ```
 */
export async function* readFilesInOrder(
  paths: ReadonlyArray<string>,
  limit: number = READ_CONCURRENCY,
): AsyncGenerator<IReadFile> {
  // A cap of 0 or negative would leave the window empty and the loop
  // would never start: it is treated as "one at a time".
  const width = Math.max(1, Math.trunc(limit));

  /** In-flight reads, in input order. */
  const window: Array<Promise<IReadFile | null>> = [];
  let next = 0;

  while (next < paths.length && window.length < width) {
    window.push(readOne(paths[next]!));
    next++;
  }

  while (window.length > 0) {
    // `shift` preserves order: we always await the oldest one, even
    // if another in the window finished earlier.
    const head = await window.shift()!;
    if (next < paths.length) {
      window.push(readOne(paths[next]!));
      next++;
    }
    if (head) yield head;
  }
}

/**
 * Same, but into an array.
 *
 * For those who need the whole list anyway (a `Map` of module → content,
 * for example). If it is only going to be walked once, use the generator:
 * it spends bounded memory instead of all of it.
 */
export async function readAllFiles(
  paths: ReadonlyArray<string>,
  limit: number = READ_CONCURRENCY,
): Promise<IReadFile[]> {
  const out: IReadFile[] = [];
  for await (const file of readFilesInOrder(paths, limit)) out.push(file);
  return out;
}
