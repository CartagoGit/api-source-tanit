export const STATE_DB_ENVIRONMENT_VARIABLE = "TANIT_STATE_DB";
export const STATE_DB_DIRECTORY_NAME = ".tanit";
export const STATE_DB_FILE_NAME = "state.sqlite";
export const STATE_DB_SCHEMA_VERSION = 2;
export const STATE_DB_BUSY_TIMEOUT_MS = 5_000;

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