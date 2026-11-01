/**
 * Where the project root comes from, in one place.
 *
 * Each command resolved it in its own way, and the three forms disagreed:
 *
 * | Command | How |
 * |---|---|
 * | `summary` | flag → `POSTMAN_PROJECT_ROOT` → `process.cwd()` |
 * | `scan` | flag → `POSTMAN_PROJECT_ROOT` → singleton's `projectRoot()` |
 * | `push` | singleton's `projectRoot()`, without checking the flag |
 *
 * Three answers to the same question, and `push`'s didn't even read
 * `--project-root`: passing it did nothing.
 *
 * Plus, none said **where** the root came from, and that matters
 * because the last resort is the current directory. Measured with
 * `watch`: launched from `/tmp`, it walked the tree, found a stray
 * project among the temp files, and generated its collection without
 * saying a word. From `$HOME` it would walk the house.
 *
 * This helper answers both things: what the root is and **why it is
 * that**. The second is what lets us warn when it was guessed.
 */
import { resolve } from "node:path";

import { readFlag } from "./argv.helper.js";
import type {
  IResolveRootOptions,
  IResolvedRoot,
} from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * The project root: `--project-root`, then `POSTMAN_PROJECT_ROOT`, and
 * as a last resort the current directory.
 *
 * The order is the one two of the three commands already had, so it
 * changes nobody's behavior — it just makes it consistent across all
 * of them and adds where it came from.
 */
export function resolveRoot(options: IResolveRootOptions = {}): IResolvedRoot {
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;

  const fromFlag = readFlag(argv, "--project-root");
  if (fromFlag !== undefined) {
    return { root: resolve(fromFlag), origin: "flag", explicit: true };
  }

  const fromEnv = env["POSTMAN_PROJECT_ROOT"];
  if (fromEnv !== undefined && fromEnv !== "") {
    return { root: resolve(fromEnv), origin: "env", explicit: true };
  }

  return { root: resolve(options.cwd ?? process.cwd()), origin: "cwd", explicit: false };
}

/**
 * The notice that the root has been guessed, or an empty string.
 *
 * Returned instead of printed so the caller decides where it goes —
 * `console.log`, a JSON report, the GUI — and so it can be tested
 * without capturing output.
 */
export function guessedRootNotice(resolved: IResolvedRoot): string {
  if (resolved.explicit) return "";
  return (
    `→ No --project-root given: using the current directory (${resolved.root}).\n` +
    "  · If this isn't your project, pass it with `--project-root <path>`."
  );
}
