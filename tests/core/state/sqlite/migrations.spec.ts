import { describe, expect, it } from "vitest";

import { Database } from "bun:sqlite";
import { STATE_DB_SCHEMA_VERSION, STATE_DB_TABLES } from "../../../../packages/contracts/constants/core/state-store.constant.js";
import { migrateStateDatabase, StateDatabaseMigrationError } from "../../../../packages/core/state/sqlite/migrations.js";

describe("state database migrations", () => {
  it("creates the fresh schema and all durable tables", () => {
    const database = new Database(":memory:");
    expect(migrateStateDatabase(database)).toBe(STATE_DB_SCHEMA_VERSION);
    const names = database.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    expect(names.map(({ name }) => name)).toEqual(expect.arrayContaining([...STATE_DB_TABLES]));
    expect(database.query("PRAGMA user_version").get()).toEqual({ user_version: STATE_DB_SCHEMA_VERSION });
    database.close();
  });

  it("migrates v1 to v2 and is idempotent", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE projects (project_id TEXT PRIMARY KEY, root_path TEXT NOT NULL, active_snapshot_id TEXT,
        revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE snapshots (snapshot_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL,
        revision INTEGER NOT NULL, captured_at TEXT NOT NULL, digest TEXT, metadata_json TEXT, failure TEXT);
      CREATE TABLE services (service_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE operations (operation_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, service_id TEXT NOT NULL,
        method TEXT NOT NULL, path TEXT NOT NULL, server_ref TEXT, auth_ref TEXT, schema_id TEXT);
      CREATE TABLE servers (server_ref TEXT NOT NULL, snapshot_id TEXT NOT NULL, url TEXT NOT NULL, metadata_json TEXT);
      CREATE TABLE auth_profiles (auth_ref TEXT NOT NULL, snapshot_id TEXT NOT NULL, scheme TEXT NOT NULL, metadata_json TEXT);
      CREATE TABLE schemas (schema_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, media_type TEXT, schema_json TEXT NOT NULL);
      CREATE TABLE diagnostics (diagnostic_id INTEGER PRIMARY KEY, snapshot_id TEXT NOT NULL, code TEXT NOT NULL,
        message TEXT NOT NULL, severity TEXT NOT NULL);
      CREATE TABLE provenance (provenance_id INTEGER PRIMARY KEY, snapshot_id TEXT NOT NULL, source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL, metadata_json TEXT);
      CREATE TABLE source_files (source_file_id INTEGER PRIMARY KEY, snapshot_id TEXT NOT NULL, path TEXT NOT NULL,
        content_digest TEXT NOT NULL, metadata_json TEXT);
      PRAGMA user_version = 1;
    `);
    const first = migrateStateDatabase(database);
    const second = migrateStateDatabase(database);
    expect(first).toBe(2);
    expect(second).toBe(2);
    expect(database.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'provenance_snapshot_idx'").get()).toEqual({ name: "provenance_snapshot_idx" });
    database.close();
  });

  it("rejects an unknown future version", () => {
    const database = new Database(":memory:");
    database.exec(`PRAGMA user_version = ${STATE_DB_SCHEMA_VERSION + 1}`);
    expect(() => migrateStateDatabase(database)).toThrow(StateDatabaseMigrationError);
    database.close();
  });

  it("fails cleanly for a corrupt database schema", () => {
    const database = new Database(":memory:");
    database.exec("PRAGMA user_version = 2; CREATE TABLE projects (broken TEXT)");
    for (const table of ["snapshots", "services", "operations", "servers", "auth_profiles", "schemas", "diagnostics", "provenance", "source_files"]) {
      database.exec(`CREATE TABLE ${table} (placeholder TEXT)`);
    }
    expect(() => migrateStateDatabase(database)).toThrow(StateDatabaseMigrationError);
    database.close();
  });

  it("rolls back a failed migration without changing the version", () => {
    const database = new Database(":memory:");
    database.exec("PRAGMA user_version = 1");
    expect(() => migrateStateDatabase(database)).toThrow(StateDatabaseMigrationError);
    expect(database.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    database.close();
  });
});