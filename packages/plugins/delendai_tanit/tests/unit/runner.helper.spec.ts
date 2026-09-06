/**
 * `runner.helper` — the frontier between the plugin and the CLI.
 *
 * The two blocks here cover failures that were alive and silent,
 * which is what makes them costly:
 *
 *   1. The plugin extracted the generated paths with regexes over
 *      the human text the CLI prints. When the CLI was translated to
 *      English, the tool kept returning `ok: true` with
 *      `collectionPath: "<not detected>"` and `requests: 0`.
 *   2. When `spawnSync` cannot start the process, `stderr` is the
 *      empty string, and the old `stderr ?? String(error)` kept it:
 *      the consumer received a failure with no explanation.
 */
import { describe, expect, test } from "vitest";

import {
  normalizeCwd,
  readGenerateReport,
  runBunCommand,
} from "../../src/lib/helpers/runner.helper";
import { SUPPORTED_REPORT_VERSION } from "../../../../packages/contracts/constants/integrations/delendai-report-version.constant";

/** A valid report, with the fields `generate --json` emits. */
function reportJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: SUPPORTED_REPORT_VERSION,
    ok: true,
    framework: "express",
    frameworks: ["express"],
    warnings: [],
    projectRoot: "/tmp/mi-api",
    projectName: "mi-api",
    collectionPath: "/tmp/mi-api/build/mi-api.postman_collection.json",
    collectionId: "71294326-8271-5a03-9d2a-1463127272b4",
    environmentPaths: ["/tmp/mi-api/build/mi-api.local.postman_environment.json"],
    extraPaths: [],
    requests: 9,
    folders: 3,
    auth: { loginEndpoint: "POST /api/auth/login", tokenVariable: "token" },
    durationMs: 45,
    ...overrides,
  });
}

describe("readGenerateReport", () => {
  test("lee un informe completo", () => {
    const result = readGenerateReport(reportJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.framework).toBe("express");
    expect(result.report.requests).toBe(9);
    expect(result.report.collectionPath).toContain(".postman_collection.json");
    expect(result.report.auth?.tokenVariable).toBe("token");
  });

  test("tolera espacios y saltos alrededor", () => {
    expect(readGenerateReport(`\n\n${reportJson()}\n `).ok).toBe(true);
  });

  test("acepta un proyecto sin login", () => {
    const result = readGenerateReport(reportJson({ auth: null }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.auth).toBeNull();
  });

  test("acepta que no se escribiera colección (modo inspect)", () => {
    const result = readGenerateReport(reportJson({ collectionPath: null }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.collectionPath).toBeNull();
  });

  // This is the regression: the CLI's human output is no longer parsed,
  // and receiving it instead of the JSON has to be an explicit error.
  test("el texto para personas ya no cuela como informe", () => {
    const humanOutput = [
      "→ Resolved paths:",
      "✔ Collection written to /tmp/mi-api/build/mi-api.postman_collection.json",
      "  · 9 requests in 3 folders (14.4 KB).",
    ].join("\n");
    const result = readGenerateReport(humanOutput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/--json/);
  });

  test("un stdout vacío da un error que lo dice", () => {
    const result = readGenerateReport("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/no ha escrito nada/);
  });

  test("un JSON que no encaja con el contrato se rechaza", () => {
    const result = readGenerateReport(JSON.stringify({ version: 1, ok: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/contrato/);
  });

  test("una versión futura del informe se rechaza con un mensaje accionable", () => {
    const result = readGenerateReport(reportJson({ version: 99 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toMatch(/99/);
      expect(result.detail).toMatch(/Actualiza el plugin/);
    }
  });
});

describe("runBunCommand", () => {
  test("un comando que funciona devuelve ok y su stdout", () => {
    const result = runBunCommand(["--version"], { cwd: process.cwd() });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("un exit code distinto de 0 se reporta sin lanzar", () => {
    const result = runBunCommand(["run", "script-que-no-existe-zzz"], {
      cwd: process.cwd(),
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  // The `stderr ?? String(error)` regression: with a missing cwd the
  // process does not start, `stderr` is "" and the failure detail was
  // previously lost entirely.
  test("si el proceso no llega a arrancar, el motivo NO se pierde", () => {
    const result = runBunCommand(["--version"], {
      cwd: "/tmp/no-such-workspace-para-el-test-12345",
    });
    expect(result.ok).toBe(false);
    expect(result.stderr).not.toBe("");
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test("mide el tiempo que ha tardado", () => {
    expect(runBunCommand(["--version"], { cwd: process.cwd() }).durationMs)
      .toBeGreaterThanOrEqual(0);
  });
});

describe("normalizeCwd", () => {
  test.each([
    ["/foo/bar", "/foo/bar"],
    ["file:///foo/bar", "/foo/bar"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeCwd(input)).toBe(expected);
  });

  test.each([undefined, "", ".", "./"])("%p cae en el cwd del proceso", (input) => {
    expect(normalizeCwd(input)).toBe(process.cwd());
  });
});
