/**
 * `summarizeProject` — the health in the `summary` output.
 *
 * The pure computation has its own spec (`project-health.spec.ts`);
 * here what is fixed is the wiring: that the summary consumed by the
 * CLI and the MCP tool carries the `health` block, and that it is
 * **consistent with the counters that the same summary already
 * declares** — a health that contradicts `withFormRequest` would be two
 * metrics choosing different specs.
 */
import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { summarizeProject } from "../../packages/core/discovery/summary.service";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";

/**
 * A minimal Express project on disk: a route with `express-validator`
 * is not present; the health for this fixture comes out without resolved
 * validation and with inferred bodies, which is exactly the "no rules"
 * case that must be distinguished from the "with rules" case.
 */
async function proyectoExpressMini(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "health-summary-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      { name: "health-mini", version: "1.0.0", dependencies: { express: "4" } },
      null,
      2,
    ),
  );
  await writeFile(
    join(root, "src", "app.js"),
    [
      "const express = require('express');",
      "const app = express();",
      "app.use(express.json());",
      "app.post('/users', (req, res) => res.json(req.body));",
      "app.get('/users', (req, res) => res.json([]));",
      "app.listen(3000);",
    ].join("\n"),
  );
  return root;
}

describe("summarizeProject — health", () => {
  test("the summary carries the health block with percentages 0..100", async () => {
    const root = await proyectoExpressMini();
    try {
      const summary = await summarizeProject(root, defaultOrchestrator());
      const health = summary.health;
      expect(health).toBeDefined();
      for (const value of [
        health.withValidationPercent,
        health.withBodySchemaPercent,
        health.withExamplesPercent,
        health.withDescriptionPercent,
      ]) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("the health is consistent with the counters of the summary itself", async () => {
    const root = await proyectoExpressMini();
    try {
      const summary = await summarizeProject(root, defaultOrchestrator());
      const total = summary.routesInCode;
      if (total === 0) return; // No routes → nothing to compare.
      const health = summary.health;
      // The validation % derived from the canonical counters must
      // match what the health declares (both round the same way).
      expect(health.withValidationPercent).toBe(
        Math.round((summary.withFormRequest / total) * 100),
      );
      // And the pipeline total wins: the computed body cannot exceed
      // what `routesInCode` says exists.
      expect(health.withBodySchemaPercent).toBeLessThanOrEqual(100);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
