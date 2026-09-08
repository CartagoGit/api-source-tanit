import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { STATE_DB_BUSY_TIMEOUT_MS, STATE_DB_SCHEMA_VERSION } from "../../../../packages/contracts/constants/core/state-store.constant.js";
import { openStateDatabase } from "../../../../packages/core/state/sqlite/sqlite-connection.adapter.js";
import { resolveStateDatabasePath } from "../../../../packages/core/state/sqlite/state-db-path.service.js";

describe("state sqlite connection", () => {
  it("configures pragmas and migrates a file database", () => {
    const directory = mkdtempSync(join(tmpdir(), "tanit-state-"));
    const path = join(directory, "state.sqlite");
    const connection = openStateDatabase(path);
    expect(connection.version).toBe(STATE_DB_SCHEMA_VERSION);
    expect(connection.database.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(connection.database.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(connection.database.query("PRAGMA busy_timeout").get()).toEqual({ timeout: STATE_DB_BUSY_TIMEOUT_MS });
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("uses TANIT_STATE_DB without exposing credentials in the path contract", () => {
    expect(resolveStateDatabasePath({ TANIT_STATE_DB: "/tmp/test-state.sqlite" })).toBe("/tmp/test-state.sqlite");
    expect(resolveStateDatabasePath({ TANIT_STATE_DB: "  " })).toContain(".tanit");
  });
});