/**
 * Folders that `watch` ignores.
 *
 * Watching an entire tree means one descriptor per directory and
 * one event per file touched by any process. `node_modules` is the
 * extreme case: a half-done `bun install` fires thousands of events
 * and none of them is an endpoint.
 *
 * This is a contract because the list is shared by whoever watches
 * and whoever walks the tree: two different criteria would detect
 * a change and skip the scan (or the reverse).
 */

import { OUTPUT_DIR_NAME } from "./postman.constant.js";

/**
 * Folders that contribute zero routes and a lot of noise.
 *
 * `node_modules` is the extreme case: a half-done `bun install`
 * fires thousands of events and none is an endpoint.
 */
/** Folder names that are neither watched nor walked. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  OUTPUT_DIR_NAME,
  "node_modules",
  "vendor",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "target",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "coverage",
  "tmp",
]);
