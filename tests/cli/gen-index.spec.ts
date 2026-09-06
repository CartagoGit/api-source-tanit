import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  collect,
  main,
  render,
} from "../../scripts/gates/gen-index.script";
import { PROPOSALS_DIR } from "../../scripts/helpers/root.helper";

/**
 * x00032 S2 — `gen-index.script.ts`.
 *
 * Lo que verificamos:
 *  1. `render()` produce un INDEX estable a partir del filesystem + frontmatter.
 *  2. `render()` cubre las tres secciones (Ready, Bloqueadas, Done).
 *  3. `main()` en modo `--check` pasa cuando INDEX.md == render().
 *  4. `main()` en modo `--check` falla cuando INDEX.md ≠ render().
 *  5. `main()` sin `--check` reescribe INDEX.md en disco.
 *
 * El fixture se construye en `mkdtempSync` para no tocar el árbol real.
 */
describe("gen-index (x00032 S2)", () => {
  let tempProposalsDir: string;
  let tempIndexPath: string;

  beforeEach(() => {
    tempProposalsDir = mkdtempSync(join(tmpdir(), "gen-index-test-"));
    tempIndexPath = join(tempProposalsDir, "INDEX.md");
  });

  afterEach(() => {
    rmSync(tempProposalsDir, { recursive: true, force: true });
  });

  // -- helpers ------------------------------------------------------------

  function writeProposal(
    relDir: string,
    fileName: string,
    frontmatter: Record<string, string | string[]>,
    body: string,
  ): void {
    const dir = join(tempProposalsDir, relDir);
    require("node:fs").mkdirSync(dir, { recursive: true });
    const fmLines: string[] = ["---"];
    for (const [key, value] of Object.entries(frontmatter)) {
      if (Array.isArray(value)) {
        fmLines.push(`${key}:`);
        for (const v of value) fmLines.push(`  - ${v}`);
      } else {
        fmLines.push(`${key}: ${value}`);
      }
    }
    fmLines.push("---", "");
    writeFileSync(join(dir, fileName), `${fmLines.join("\n")}${body}\n`);
  }

  // -- tests --------------------------------------------------------------

  test("render() produce un INDEX estable a partir del filesystem + frontmatter", async () => {
    writeProposal(
      "ready/fixes",
      "x99999-ejemplo.md",
      {
        id: "x99999",
        kind: "fix",
        status: "ready",
        title: "Ejemplo de prueba",
      },
      "# Ejemplo\n\nCuerpo de la propuesta.",
    );
    writeProposal(
      "done/fixes",
      "x99998-archivada.md",
      {
        id: "x99998",
        kind: "fix",
        status: "done",
        title: "Propuesta archivada",
        shippedIn: ["abc1234"],
      },
      "# Archivada\n\nLista para archivar.",
    );
    writeProposal(
      "blocked",
      "x99997-bloqueada.md",
      {
        id: "x99997",
        kind: "fix",
        status: "blocked",
        title: "Bloqueada por X",
        blockedReason: "esperando Y",
      },
      "# Bloqueada\n\nCuerpo.",
    );

    const proposals = await collect(tempProposalsDir);
    const out = await render(proposals);

    expect(out).toContain("## Ready");
    expect(out).toContain("## Bloqueadas");
    expect(out).toContain("## Done");
    expect(out).toContain("`x99999`");
    expect(out).toContain("`x99998`");
    expect(out).toContain("`x99997`");
    // Determinism: same input → same output.
    const out2 = await render(proposals);
    expect(out2).toBe(out);
  });

  test("main() --check pasa cuando INDEX.md == render()", async () => {
    writeProposal(
      "ready/fixes",
      "x99999-ok.md",
      {
        id: "x99999",
        kind: "fix",
        status: "ready",
        title: "OK",
      },
      "# OK\n",
    );
    // Pre-compute the expected INDEX and write it.
    const proposals = await collect(tempProposalsDir);
    const expected = await render(proposals);
    writeFileSync(tempIndexPath, expected);

    const exit = await main({
      proposalsDir: tempProposalsDir,
      indexPath: tempIndexPath,
      argv: ["--check"],
    });
    expect(exit).toBe(0);
  });

  test("main() --check falla cuando INDEX.md ≠ render()", async () => {
    writeProposal(
      "ready/fixes",
      "x99999-mismatch.md",
      {
        id: "x99999",
        kind: "fix",
        status: "ready",
        title: "OK",
      },
      "# OK\n",
    );
    // Write a stale INDEX.
    writeFileSync(tempIndexPath, "# Stale\n\ndesincronizado a mano\n");

    const exit = await main({
      proposalsDir: tempProposalsDir,
      indexPath: tempIndexPath,
      argv: ["--check"],
    });
    expect(exit).toBe(1);
  });

  test("main() sin --check reescribe INDEX.md en disco", async () => {
    writeProposal(
      "ready/fixes",
      "x99999-write.md",
      {
        id: "x99999",
        kind: "fix",
        status: "ready",
        title: "Write",
      },
      "# Write\n",
    );
    // Pre-existing stale INDEX.
    writeFileSync(tempIndexPath, "# Stale\n");

    const exit = await main({
      proposalsDir: tempProposalsDir,
      indexPath: tempIndexPath,
      argv: [],
    });
    expect(exit).toBe(0);
    const onDisk = readFileSync(tempIndexPath, "utf8");
    expect(onDisk).toContain("`x99999`");
    expect(onDisk).not.toContain("Stale");
  });

  test("en develop actual el script regenera un INDEX coherente con el filesystem", async () => {
    // This is an integration smoke against the real proposals tree.
    // It catches e.g. a frontmatter shape change that the renderer
    // doesn't know about.
    const proposals = await collect(PROPOSALS_DIR);
    expect(proposals.length).toBeGreaterThan(0);
    const out = await render(proposals);
    expect(out).toMatch(/^# Proposals/m);
    // Each ready proposal in the real tree appears in the table.
    const ready = proposals.filter((p) => p.status === "ready");
    for (const p of ready) {
      expect(out).toContain(`\`${p.id}\``);
    }
    // Done proposals do NOT appear in the Ready table.
    const readyTable = out.split("## Bloqueadas")[0] ?? "";
    const done = proposals.filter((p) => p.status === "done");
    for (const p of done) {
      expect(readyTable).not.toContain(`\`${p.id}\``);
    }
  });
});
