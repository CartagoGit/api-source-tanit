import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

import {
  STATE_DB_BUSY_TIMEOUT_MS,
  STATE_DB_SCHEMA_VERSION,
} from "../../../contracts/constants/core/state-store.constant.js";
import { migrateStateDatabase } from "./migrations.js";
import { resolveStateDatabasePath } from "./state-db-path.service.js";

export interface IStateDatabaseConnection {
  readonly path: string;
  readonly version: number;
  readonly database: Database;
  close(): void;
}

export function openStateDatabase(path = resolveStateDatabasePath()): IStateDatabaseConnection {
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { create: true, strict: true });
  database.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = ${STATE_DB_BUSY_TIMEOUT_MS};`);
  const version = migrateStateDatabase(database);
  if (version !== STATE_DB_SCHEMA_VERSION) {
    database.close();
    throw new Error(`Unexpected state database version: ${version}`);
  }
  return { path, version, database, close: () => database.close() };
}