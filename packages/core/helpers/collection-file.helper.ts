/**
 * Read the collection from disk, or explain why it cannot be.
 *
 * Four commands — `list`, `stats`, `check` and `validate` — start by
 * reading the same file, and each did it in its own way. `list` and
 * `stats` didn't do it in any: they called `readFile` directly, and
 * without a collection on disk the person saw this:
 *
 * ```
 * 20 |   const raw = await readFile(COLLECTION_PATH, "utf8");
 *                          ^
 * ENOENT: no such file or directory, open '/…/sample-express.postman_collection.json'
 *     path: "/…"
 *  syscall: "open"
 * ```
 *
 * Five lines of stack trace, the command's source code above, and not
 * a word about what to do — when the answer is always the same: run
 * `generate` first.
 *
 * An error that does not say the next step leaves the reader as stuck
 * as if it said nothing, and on top of it looks like the tool is
 * broken.
 */
import { readFile } from "node:fs/promises";

import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import type { CollectionRead } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * Reads and parses the collection.
 *
 * Distinguishes the three failures that matter, because each has a
 * different output: that it does not exist (need to generate), that it
 * cannot be read (permissions), and that it is not valid JSON (it was
 * written halfway, which is what `atomic-write.helper` exists to
 * prevent).
 */
export async function readCollection(path: string): Promise<CollectionRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        reason: `No collection at '${path}'.`,
        nextAction:
          "Generate it first:\n" +
          "  apisrc generate --project-root <your-project>\n" +
          "If it lives elsewhere, say so with `--output-dir`.",
      };
    }
    return {
      ok: false,
      reason: `Could not read '${path}': ${(error as Error).message}`,
      nextAction: "Check the permissions on the file and its folder.",
    };
  }

  try {
    return { ok: true, collection: JSON.parse(raw) as PostmanCollection };
  } catch (error) {
    return {
      ok: false,
      reason: `'${path}' exists but is not valid JSON: ${(error as Error).message}`,
      nextAction:
        "That usually means it was written halfway. Generate it again:\n" +
        "  apisrc generate --project-root <your-project>",
    };
  }
}

/**
 * Prints the failure in the same format as the rest of the CLI and
 * returns 1, so a command can do `return explain(result)` without
 * repeating the `console.error` block in each one.
 */
export function explainReadFailure(
  failure: Extract<CollectionRead, { ok: false }>,
): number {
  console.error(`\n✗ ${failure.reason}`);
  for (const line of failure.nextAction.split("\n")) {
    console.error(`  · ${line}`);
  }
  return 1;
}
