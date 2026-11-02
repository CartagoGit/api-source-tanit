/**
 * Constants of the generation history.
 *
 * What lives here is invariant: filename, folder permissions, entry
 * version number. Changing it **moves** the history — the file gets a
 * new name, old readers do not understand the new version — which is
 * why these are constants and not configurable parameters: if anyone
 * wants a custom path, they should use a different folder.
 */

/**
 * Permission to use when the history folder needs to be created.
 *
 * `0o755` on Unix: the owner can write, everyone else can only read.
 * It is reasonable for a log that only the running program (as that
 * user) writes to, and nobody else needs to modify.
 */
export const HISTORY_DIR_MODE = 0o755;

/**
 * Version of each history entry's shape.
 *
 * Bumps when a field changes or serialization is reordered. The
 * number is embedded in each JSONL line — it is the first thing any
 * future parser looks at — and lets it ignore older entries when the
 * shape changes incompatibly.
 */
export const HISTORY_ENTRY_VERSION = 1;

/**
 * Name of the history file inside the user's directory.
 *
 * `.jsonl` rather than `.json` by design: each generation appends one
 * line, and two concurrent writes — the UI and a `watch`, say — must
 * not race to rewrite the whole file. JSONL enables atomic line
 * appends.
 */
export const HISTORY_FILE_NAME = "history.jsonl";

/**
 * Name of the history folder, hidden on Unix.
 *
 * Kept separate from the config folder (which is `tanit`, without
 * the leading dot, and lives under `~/.config/` or similar) because
 * their purposes differ: the first stores settings and languages
 * the user edits by hand; the second is the log the tool writes
 * on its own.
 */
export const HISTORY_DIR_NAME = ".tanit";
