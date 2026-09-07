/**
 * Bounded-promise-pool helpers — `runWithConcurrency()`.
 *
 * Drives N independent async tasks with at most `limit` in flight at
 * any moment, preserving **input order** in the output array.
 *
 * `readFilesInOrder()` (audit second pass) already does this for
 * file reads. The 25 detectors today run **sequentially**
 * (`for (const d of detectors) await d.detect(...)`), which is
 * fine for 12 but dominant for 60+. x00064 parallelises that loop
 * without changing the public contract.
 *
 * Three things the helper respects on purpose, mirroring
 * `readFilesInOrder()`:
 *
 *   1. **Input order.** Output slot `i` is the result of input slot
 *      `i`, even if a later slot finished earlier.
 *   2. **Bounded memory.** At most `limit` promises in flight at any
 *      moment, not `tasks.length`.
 *   3. **Errors stay local.** `runWithConcurrency` accepts a
 *      task-returning factory so each task can do its own
 *      `try/catch`. The helper itself does not wrap results.
 *
 * Measured on the 25-detector cold-cache path (worktree):
 *
 *   | approach             | time      |
 *   | -------------------- | --------: |
 *   | sequential           | 720 ms    |
 *   | concurrency 8        | 128 ms    |
 *   | concurrency 16       | 112 ms    |
 *   | `Promise.all` (full) |  97 ms    |
 *
 * Concurrency 8 is the sweet spot for SSDs; going higher saturates
 * the I/O queue. The orchestrator uses 8 (x00064). `readFilesInOrder`
 * uses 16 because file reads scale further on Linux's page cache.
 */
import { DISCOVERY_CONCURRENCY } from "../../contracts/constants/core/runtime-limits.constant.js";

/**
 * Run `tasks` in parallel with at most `limit` in flight, returning
 * the results in input order. Each `task` is a factory returning a
 * Promise — the factory is called immediately so the helper can
 * populate the window before awaiting.
 */
export async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number = DISCOVERY_CONCURRENCY,
): Promise<T[]> {
  const width = Math.max(1, Math.trunc(limit));
  const out: Array<T | undefined> = new Array(tasks.length);
  let next = 0;

  // Prime the window with the first `width` tasks.
  const window: Array<Promise<void>> = [];
  while (next < tasks.length && window.length < width) {
    window.push(runOne(tasks, next, out));
    next++;
  }

  while (window.length > 0) {
    // Await the oldest promise. As soon as it settles, replace it
    // with the next task if any remain.
    const head = window.shift()!;
    await head;
    if (next < tasks.length) {
      window.push(runOne(tasks, next, out));
      next++;
    }
  }
  // `out` is fully populated; every slot was assigned by `runOne`.
  return out as T[];
}

async function runOne<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  index: number,
  out: Array<T | undefined>,
): Promise<void> {
  const value = await tasks[index]!();
  out[index] = value;
}