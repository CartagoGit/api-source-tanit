export const STATE_DB_ENVIRONMENT_VARIABLE = "TANIT_STATE_DB";
export const STATE_DB_DIRECTORY_NAME = ".tanit";
export const STATE_DB_FILE_NAME = "state.sqlite";
export const STATE_DB_SCHEMA_VERSION = 2;
export const STATE_DB_BUSY_TIMEOUT_MS = 5_000;

/**
 * Where the persisted history of a project lives.
 *
 * It sits **next to** the state store, in the user's own folder, and
 * never inside the project: a tool that writes into the project it
 * analyses changes what it analyses.
 */
export const HISTORY_STORE_ENVIRONMENT_VARIABLE = "TANIT_HISTORY_DIR";
export const HISTORY_STORE_DIRECTORY_NAME = "history";

export const STATE_DB_TABLES = [
  "projects",
  "snapshots",
  "services",
  "operations",
  "servers",
  "auth_profiles",
  "schemas",
  "diagnostics",
  "provenance",
  "source_files",
] as const;

export type StateDbTable = (typeof STATE_DB_TABLES)[number];