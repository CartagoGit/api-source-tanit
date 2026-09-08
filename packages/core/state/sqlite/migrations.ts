import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  STATE_DB_SCHEMA_VERSION,
  STATE_DB_TABLES,
} from "../../../contracts/constants/core/state-store.constant.js";

export interface IStateMigrationDatabase {
  exec(sql: string): void;
  query(sql: string): { get(): unknown; all?(): unknown[] };
}

export interface IStateMigration {
  readonly version: number;
  readonly up: (database: IStateMigrationDatabase) => void;
  readonly down: (database: IStateMigrationDatabase) => void;
}

export class StateDatabaseMigrationError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StateDatabaseMigrationError";
  }
}

const SCHEMA_SQL = readFileSync(join(import.meta.dir, "schema.sql"), "utf8");

const ADD_PROVENANCE_INDEX = "CREATE INDEX IF NOT EXISTS provenance_snapshot_idx ON provenance(snapshot_id);";

export const STATE_DATABASE_MIGRATIONS: readonly IStateMigration[] = [
  {
    version: 1,
    up: (database) => database.exec(SCHEMA_SQL),
    down: (database) => {
      for (const table of [...STATE_DB_TABLES].reverse()) database.exec(`DROP TABLE IF EXISTS ${table};`);
    },
  },
  {
    version: 2,
    up: (database) => database.exec(ADD_PROVENANCE_INDEX),
    down: (database) => database.exec("DROP INDEX IF EXISTS provenance_snapshot_idx;"),
  },
];

function readVersion(database: IStateMigrationDatabase): number {
  const row = database.query("PRAGMA user_version").get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

function setVersion(database: IStateMigrationDatabase, version: number): void {
  database.exec(`PRAGMA user_version = ${version}`);
}

function validateSchema(database: IStateMigrationDatabase): void {
  const rows = database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all?.() as
    | Array<{ name?: string }>
    | undefined;
  const tables = new Set(rows?.map((row) => row.name).filter((name): name is string => name !== undefined));
  const missing = STATE_DB_TABLES.filter((table) => !tables.has(table));
  if (missing.length > 0) {
    throw new StateDatabaseMigrationError(`Corrupt state database; missing tables: ${missing.join(", ")}`);
  }
}

export function migrateStateDatabase(database: IStateMigrationDatabase): number {
  const currentVersion = readVersion(database);
  if (currentVersion > STATE_DB_SCHEMA_VERSION) {
    throw new StateDatabaseMigrationError(`Unsupported future state database version: ${currentVersion}`);
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const migration of STATE_DATABASE_MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      migration.up(database);
      setVersion(database, migration.version);
    }
    if (STATE_DB_SCHEMA_VERSION > 0) validateSchema(database);
    database.exec("COMMIT");
    return STATE_DB_SCHEMA_VERSION;
  } catch (error) {
    database.exec("ROLLBACK");
    if (error instanceof StateDatabaseMigrationError) throw error;
    throw new StateDatabaseMigrationError("State database migration failed", { cause: error });
  }
}