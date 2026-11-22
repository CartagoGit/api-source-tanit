/**
 * Las notas de la release salen del CHANGELOG, y si no hay sección no
 * hay release.
 *
 * ## Por qué esto tiene test
 *
 * Porque el workflow que corta la release **para** cuando el script
 * falla. Si la regla extrajera la sección equivocada —o la primera,
 * que puede ser la de otra versión— la release saldría con las notas
 * de otro día, y nadie se enteraría hasta que alguien la lea.
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";
import { sectionFor } from "../../scripts/helpers/release-notes.helper.js";
import { CLI_VERSION } from "../../packages/contracts/constants/cli/cli-version.constant.js";

async function changelog(): Promise<string> {
  return readFile(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
}

describe("las notas de la release", () => {
  test("la sección de la versión del repo existe", async () => {
    const section = sectionFor(await changelog(), CLI_VERSION);
    expect(section).not.toBeNull();
    expect(section).toContain(`## ${CLI_VERSION}`);
  });

  test("la sección lleva su encabezado y su cuerpo", async () => {
    const section = sectionFor(await changelog(), CLI_VERSION) ?? "";
    const lines = section.split("\n");
    expect(lines[0]).toContain(`## ${CLI_VERSION}`);
    // Un encabezado solo, sin cuerpo, no son notas.
    expect(section.length).toBeGreaterThan(lines[0]?.length ?? 0);
  });

  test("la sección no se come la siguiente", () => {
    const text =
      "## 1.0.0\n\nNotas de la primera.\n\n## 2.0.0\n\nNotas de la segunda.\n";
    const section = sectionFor(text, "1.0.0") ?? "";
    expect(section).toContain("Notas de la primera.");
    expect(section).not.toContain("Notas de la segunda.");
  });

  test("una versión que no está no tiene sección", async () => {
    expect(sectionFor(await changelog(), "9.9.9")).toBeNull();
    expect(sectionFor(await changelog(), "")).toBeNull();
  });

  test("una sección sin cuerpo tampoco son notas", () => {
    expect(sectionFor("", "1.0.0")).toBeNull();
    expect(sectionFor("## 1.0.0\n\n## 2.0.0\n", "1.0.0")).toBe("## 1.0.0");
  });
});
