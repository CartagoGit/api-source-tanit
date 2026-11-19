#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { STATE_DB_SCHEMA_VERSION } from "../../contracts/constants/core/state-store.constant.js";
import type { IDoctorOutcome, IDoctorReport } from "../../contracts/interfaces/core/doctor.interface.js";

export type { IDoctorOutcome, IDoctorReport } from "../../contracts/interfaces/core/doctor.interface.js";
import { hasFlag, readFlag } from "../../core/helpers/argv.helper.js";
import { resolveStateDatabasePath } from "../../core/state/sqlite/state-db-path.service.js";

function missingReport(databasePath: string, reason: string): IDoctorReport {
  return {
    databasePath,
    database: "missing",
    dbVersion: null,
    migration: "unavailable",
    activeSnapshot: null,
    lastWrite: null,
    corruption: reason,
    parity: "unavailable",
    secretsOmitted: true,
  };
}

export async function runDoctor(argv: string[] = process.argv.slice(2)): Promise<IDoctorOutcome> {
  const databasePath = readFlag(argv, "--state-db") ?? resolveStateDatabasePath();
  let report: IDoctorReport;
  if (!existsSync(databasePath)) {
    report = missingReport(databasePath, "State database does not exist");
  } else {
    try {
      const { openStateDatabase } = await import("../../core/state/sqlite/sqlite-connection.adapter.js");
      const connection = openStateDatabase(databasePath);
      try {
        const active = connection.database.query("SELECT active_snapshot_id FROM projects WHERE active_snapshot_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1").get() as { active_snapshot_id?: string } | null;
        const latest = connection.database.query("SELECT captured_at FROM snapshots WHERE status = 'complete' ORDER BY captured_at DESC LIMIT 1").get() as { captured_at?: string } | null;
        report = {
          databasePath,
          database: "available",
          dbVersion: connection.version,
          migration: connection.version === STATE_DB_SCHEMA_VERSION ? "current" : "unavailable",
          activeSnapshot: active?.active_snapshot_id ?? null,
          lastWrite: latest?.captured_at ?? null,
          corruption: null,
          parity: "not-run",
          secretsOmitted: true,
        };
      } finally {
        connection.close();
      }
    } catch (error) {
      report = missingReport(databasePath, error instanceof Error ? error.message : String(error));
      report = { ...report, database: report.corruption?.includes("Corrupt") ? "corrupt" : "missing" };
    }
  }

  const output = hasFlag(argv, "--json") ? JSON.stringify(report) : [
    `Database: ${report.database}`,
    `Path: ${report.databasePath}`,
    `DB version: ${report.dbVersion ?? "unavailable"}`,
    `Migration: ${report.migration}`,
    `Active snapshot: ${report.activeSnapshot ?? "none"}`,
    `Last write: ${report.lastWrite ?? "none"}`,
    `Corruption: ${report.corruption ?? "none"}`,
    `Parity: ${report.parity}`,
    "Secrets: omitted",
  ].join("\n");
  return { code: report.database === "available" ? 0 : 1, output, report };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const outcome = await runDoctor(argv);
  process.stdout.write(`${outcome.output}\n`);
  return outcome.code;
}

if (import.meta.main) process.exit(await main());