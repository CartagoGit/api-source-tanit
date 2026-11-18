/**
 * Watches the project and reports when something changes.
 *
 * The reason this exists is workflow-related: someone adding an endpoint
 * should not have to remember to regenerate the collection. The reason it is
 * so careful, however, is different—and it is the important one here.
 *
 * **The tool writes INSIDE what it watches.** The collection goes to
 * `<project>/tanit/`, which hangs from the same root being watched. A naive
 * watcher sees its own write, regenerates, writes again, sees itself again—
 * and never stops. It is an infinite loop that consumes disk and CPU, exactly
 * the kind that took down an entire WSL session in this repo.
 *
 * That is why the output folder is ignored **always**, not by configuration,
 * and why `shouldIgnore` is a pure function with tests: it is the piece this
 * relies on to avoid hanging.
 *
 * The other safeguard is debouncing. Saving a file in an editor can trigger
 * multiple events (write, temporary-file rename, attribute change), and a
 * repeated `Ctrl+S` triggers more. Without batching, each would launch a
 * full project scan.
 */
import { watch, type FSWatcher } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

import type { IWatchHandle, IWatchOptions } from "../../contracts/interfaces/core/domain.interface.js";
import { DEFAULT_DEBOUNCE_MS } from "../../contracts/constants/core/runtime-limits.constant.js";
import { IGNORED_DIRS } from "../../contracts/constants/core/watch.constant.js";

/** Files that change on their own and are not code: editor temporaries. */
const IGNORED_FILE_RE = /(^\.|~$|\.swp$|\.swx$|\.tmp$|^\d+$)/;

/**
 * Whether a relative path should be ignored.
 *
 * Pure and exported intentionally: this is the piece that prevents the
 * infinite loop, and a piece like that must be testable without mounting a
 * filesystem.
 */
export function shouldIgnore(
  relativePath: string,
  extraIgnored: ReadonlySet<string> = new Set(),
): boolean {
  if (!relativePath || relativePath === ".") return true;
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  for (const segment of segments) {
    if (IGNORED_DIRS.has(segment)) return true;
    if (extraIgnored.has(segment)) return true;
  }
  const fileName = segments[segments.length - 1] ?? "";
  // A file without a dot can be a folder; only files that look like
  // temporaries are filtered out.
  return IGNORED_FILE_RE.test(fileName);
}

/**
 * Batches consecutive calls into one, `ms` after the last one.
 *
 * It also returns a `cancel` function so it can close without leaving a
 * timer running: otherwise the process does not terminate on Ctrl+C because
 * the event loop still has pending work.
 */
export function createDebouncer(
  ms: number,
  fn: (batch: readonly string[]) => void,
): { trigger(path: string): void; cancel(): void; pending(): number } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let batch: string[] = [];

  return {
    trigger(path: string): void {
      if (!batch.includes(path)) batch.push(path);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const current = batch;
        batch = [];
        timer = null;
        fn(current);
      }, ms);
    },
    cancel(): void {
      if (timer) clearTimeout(timer);
      timer = null;
      batch = [];
    },
    pending(): number {
      return batch.length;
    },
  };
}

/**
 * Watches `root` and calls `onChange` with the changed paths.
 *
 * It uses recursive `fs.watch` without polling. If the operating system does
 * not support it —`recursive` is not available on all BSDs— it throws a message
 * explaining that instead of watching only the first level and missing
 * everything.
 *
 * There are never two `onChange` calls at once: if a change arrives while
 * regeneration is running, it is queued and runs afterward. Two simultaneous
 * generations would write the same file at the same time.
 */
export function watchProject(options: IWatchOptions): IWatchHandle {
  const { root, onChange } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const extraIgnored = options.ignoreDirs ?? new Set<string>();

  let running = false;
  let queued: string[] | null = null;

  async function run(batch: readonly string[]): Promise<void> {
    if (running) {
      // It accumulates instead of being lost: someone saving while
      // regeneration is running can expect their change to be included.
      queued = [...(queued ?? []), ...batch];
      return;
    }
    running = true;
    try {
      await onChange(batch);
    } finally {
      running = false;
      const next = queued;
      queued = null;
      if (next && next.length > 0) void run(next);
    }
  }

  const debouncer = createDebouncer(debounceMs, (batch) => void run(batch));

  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, fileName) => {
      if (!fileName) return;
      const raw = fileName.toString();
      // `fs.watch` gives the **relative** path to the watched folder on Linux
      // and Windows, and an absolute path in some macOS cases. We need to
      // distinguish them: passing an already relative path through `relative()`
      // resolves it against the cwd and produces a `../../../..` path that means
      // nothing.
      //
      // This is not theoretical: with the cwd in `/tmp/...`, the result
      // contained a `tmp` segment, which is in the ignored list, so the watcher
      // discarded **all** changes and appeared broken.
      const candidate = (isAbsolute(raw) ? relative(root, raw) : raw)
        .split(sep)
        .join("/");
      if (!candidate) return;
      if (shouldIgnore(candidate, extraIgnored)) return;
      debouncer.trigger(candidate);
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo vigilar ${root}: ${detail}\n` +
        "  El modo watch necesita `fs.watch` recursivo, que no está en todos\n" +
        "  los sistemas. Sin él solo se vería el primer nivel de carpetas, que\n" +
        "  es peor que no vigilar: parecería funcionar y no avisaría de nada.",
    );
  }

  return {
    close(): void {
      debouncer.cancel();
      watcher.close();
    },
  };
}
