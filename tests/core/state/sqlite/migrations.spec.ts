import { describe, expect, it } from "bun:test";

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
    migrateStateDatabase(database);
    database.exec("PRAGMA user_version = 1");
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
    database.exec("PRAGMA user_version = 1; CREATE TABLE projects (broken TEXT)");
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