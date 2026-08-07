/**
 * `runner.helper` — la frontera entre el plugin y el CLI.
 *
 * Los dos bloques de aquí cubren fallos que estuvieron vivos y en
 * silencio, que es lo que los hace caros:
 *
 *   1. El plugin sacaba las rutas generadas con expresiones regulares
 *      sobre el texto que el CLI imprime para personas. Cuando el CLI
 *      se tradujo al inglés, el tool siguió devolviendo `ok: true` con
 *      `collectionPath: "<no detectado>"` y `requests: 0`.
 *   2. Cuando `spawnSync` no consigue arrancar el proceso, `stderr` es
 *      la cadena vacía, y el `stderr ?? String(error)` se quedaba con
 *      ella: el consumidor recibía un fallo sin ninguna explicación.
 */
import { describe, expect, test } from "vitest";

import {
  SUPPORTED_REPORT_VERSION,
  normalizeCwd,
  readGenerateReport,
  runBunCommand,
} from "../../src/lib/helpers/runner.helper";

/** Un informe válido, con los campos que emite `generate --json`. */
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

  // Esta es la regresión: la salida legible del CLI ya no se parsea, y
  // recibirla en vez del JSON tiene que ser un error explícito.
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

  // La regresión del `stderr ?? String(error)`: con un cwd inexistente
  // el proceso no llega a arrancar, `stderr` es "" y antes el detalle
  // del fallo se perdía entero.
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
