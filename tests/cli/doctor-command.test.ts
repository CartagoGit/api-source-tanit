import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { runDoctor } from "../../packages/cli/commands/doctor.script";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

describe("doctor command", () => {
  it("returns stable JSON diagnostics when the database is absent", async () => {
    directory = await mkdtemp(join(tmpdir(), "tanit-doctor-"));
    const result = await runDoctor(["--json", "--state-db", join(directory, "missing.sqlite")]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.output)).toEqual({
      databasePath: join(directory, "missing.sqlite"),
      database: "missing",
      dbVersion: null,
      migration: "unavailable",
      activeSnapshot: null,
      lastWrite: null,
      corruption: expect.any(String),
      parity: "unavailable",
      secretsOmitted: true,
    });
  });

  it("reports the migrated database without exposing secret metadata", async () => {
    directory = await mkdtemp(join(tmpdir(), "tanit-doctor-"));
    const databasePath = join(directory, "state.sqlite");
    execFileSync("bun", ["-e", [
      'import { openStateDatabase } from "./packages/core/state/sqlite/sqlite-connection.adapter.ts";',
      "const connection = openStateDatabase();",
      'connection.database.exec("INSERT INTO projects (project_id, root_path, created_at, updated_at) VALUES (\'p\', \'/tmp/p\', \'2026-09-09\', \'2026-09-09\')");',
      'connection.close();',
    ].join(" ")], { cwd: process.cwd(), stdio: "pipe", env: { ...process.env, TANIT_STATE_DB: databasePath } });
    const output = execFileSync("bun", ["-e", [
      'import { runDoctor } from "./packages/cli/commands/doctor.script.ts";',
      `const result = await runDoctor(["--json", "--state-db", ${JSON.stringify(databasePath)}]);`,
      "process.stdout.write(JSON.stringify(result));",
    ].join(" ")], { cwd: process.cwd(), stdio: "pipe" }).toString();
    const result = JSON.parse(output) as { code: number; report: { database: string; dbVersion: number; secretsOmitted: boolean }; output: string };
    expect(result.code).toBe(0);
    expect(result.report.database).toBe("available");
    expect(result.report.dbVersion).toBeGreaterThan(0);
    expect(result.output).not.toContain("password");
    expect(result.output).not.toContain("token");
    expect(result.report.secretsOmitted).toBe(true);
  });
});