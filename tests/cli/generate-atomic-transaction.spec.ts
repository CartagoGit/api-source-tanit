/**
 * x00060 — generate runs as a single transaction: validate BEFORE any
 * write so a regression / scanner crash cannot destroy yesterday's
 * collection.
 *
 * Pins the contract:
 *   - 0 endpoints + no `--allow-empty` → exit 1, OUTPUT_PATH not touched.
 *   - 0 endpoints + `--allow-empty` → exit 0, OUTPUT_PATH contains the
 *     empty collection.
 *   - N>0 endpoints → exit 0, OUTPUT_PATH exists with the N requests.
 *   - OUTPUT_PATH already has a valid collection; the empty write
 *     refuses to overwrite it (simulated scanner regression).
 */
import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runGenerate } from "../../packages/cli/commands/generate.script.js";

describe("x00060 — generate as a single transaction (validate before write)", () => {
  let work: string;

  afterEach(() => {
    if (work && existsSync(work)) {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("(1) 0 endpoints + no --allow-empty → exit 1, OUTPUT_PATH untouched", async () => {
    work = mkdtempSync(join(tmpdir(), "x60-untouched-"));
    // Pre-write a valid collection at the expected OUTPUT_PATH.
    mkdirSync(join(work, "apps"), { recursive: true });
    const outputPath = join(work, "x60.postman_collection.json");
    const previousContent = JSON.stringify({
      info: { name: "previous", _postman_id: "previous" },
      item: [
        {
          name: "GET /yesterday",
          request: {
            method: "GET",
            url: { raw: "{{baseUrl}}/yesterday", host: ["{{baseUrl}}"], path: ["yesterday"] },
          },
        },
      ],
    });
    writeFileSync(outputPath, previousContent, "utf8");

    const result = await runGenerate([
      "--project-root", work,
      "--output", outputPath,
      // No --allow-empty
    ]);
    // Exit non-zero because there are no endpoints.
    expect(result.code).not.toBe(0);

    // OUTPUT_PATH keeps its previous content. THIS is the bug the
    // proposal fixes: today the file is overwritten with an empty
    // collection BEFORE the empty check runs.
    const after = readFileSync(outputPath, "utf8");
    expect(after).toBe(previousContent);
  });

  test("(2) 0 endpoints + --allow-empty → exit 0, OUTPUT_PATH has empty collection", async () => {
    work = mkdtempSync(join(tmpdir(), "x60-allow-empty-"));
    mkdirSync(join(work, "apps"), { recursive: true });
    const outputPath = join(work, "x60.postman_collection.json");

    const result = await runGenerate([
      "--project-root", work,
      "--output", outputPath,
      "--allow-empty",
    ]);
    expect(result.code).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
  });

  test("(3) N>0 endpoints → exit 0, OUTPUT_PATH exists with N requests", async () => {
    work = mkdtempSync(join(tmpdir(), "x60-happy-"));
    // Minimal Express project with one route.
    writeFileSync(
      join(work, "package.json"),
      JSON.stringify({
        name: "x60-happy",
        dependencies: { express: "^4.19.2" },
      }),
      "utf8",
    );
    writeFileSync(
      join(work, "server.js"),
      `
        import express from "express";
        const app = express();
        app.get("/health", (_req, res) => res.json({ ok: true }));
      `,
      "utf8",
    );
    const outputPath = join(work, "x60.postman_collection.json");

    const result = await runGenerate([
      "--project-root", work,
      "--output", outputPath,
    ]);
    expect(result.code).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(outputPath, "utf8"));
    const items = parsed?.item ?? [];
    expect(items.length).toBeGreaterThan(0);
  });
});