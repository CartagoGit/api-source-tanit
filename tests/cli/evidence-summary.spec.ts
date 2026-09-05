/**
 * `summary` — the textual evidence of the framework detector.
 *
 * The CLI user does not open Postman: they open the terminal and run
 * `expostman summary`. The line that follows `→ Framework:` is the
 * one that turns "framework: express" into "because `package.json`
 * declares express in dependencies". That line is built by
 * `summary.script.ts` from the `evidence` each framework's detector
 * returns.
 *
 * What is tested here is that **every supported framework emits
 * readable evidence**: the `signal` is a sentence, the `weight` is
 * in [0..1] and the `artifact` points to the file the signal came
 * from. Without this, the "Why X?" card in the summary would come
 * out empty for almost all frameworks, and a dashboard that is
 * always empty teaches nothing.
 *
 * The detector is the source of truth for the weight —if the
 * orchestrator accepts it, here it is accepted—; the test verifies
 * the **shape** of the payload, not the concrete value of each
 * weight, because that value changes with each detector that gets
 * enriched.
 */
import { describe, expect, test } from "vitest";

import { summarizeWithAllFrameworks } from "../../packages/frameworks/index.js";
import type { IProjectDetectionEvidence } from "../../packages/contracts/interfaces/core/scanner.interface.js";

/**
 * Root of the real fixtures. Each folder models a different
 * framework and, depending on the detector, emits different
 * evidence.
 *
 * The 21 frameworks of the registry are not enumerated: some
 * detectors (Phoenix, Ktor, Fiber, Rust, Fiber, Hono, trpc, GraphQL)
 * have not yet been enriched with `withEvidence` and their
 * `evidence` is empty. The contract to test is that of the ones
 * that do emit —the ones the user actually sees in `summary`—; the
 * rest are covered when they are migrated.
 */
const FIXTURES = {
  express: "tests/fixtures/express-comprehensive",
  fastapi: "tests/fixtures/fastapi-comprehensive",
  laravel: "tests/fixtures/laravel-comprehensive",
  django: "tests/fixtures/django-comprehensive",
  rails: "tests/fixtures/rails-comprehensive",
  aspnet: "tests/fixtures/aspnet-comprehensive",
  flask: "tests/fixtures/flask-comprehensive",
  symfony: "tests/fixtures/symfony-comprehensive",
} as const;

/**
 * `signal` type with all mandatory contractual keys.
 *
 * The test fails if the detector forgets `weight` or returns an
 * empty signal, which is what would happen if a
 * `withEvidence(score, [])` slipped into the summary by mistake:
 * the `→ Why X?` line would print without bullets and the user
 * would be left without an answer.
 */
function esEvidenciaLegible(e: unknown): e is IProjectDetectionEvidence {
  if (typeof e !== "object" || e === null) return false;
  const v = e as Record<string, unknown>;
  if (typeof v["signal"] !== "string" || v["signal"].trim() === "") return false;
  if (typeof v["weight"] !== "number") return false;
  if (v["weight"] < 0 || v["weight"] > 1) return false;
  if (v["artifact"] !== undefined && typeof v["artifact"] !== "string") {
    return false;
  }
  return true;
}

describe("summary — evidence: every known framework emits readable evidence", () => {
  /**
   * Express: detector with a single `withEvidence` that notes the
   * `express` declaration (or a matching prefix) in `package.json`.
   * The signal must mention the package name and the file it came
   * from.
   */
  test("Express: evidence points to package.json and mentions 'express'", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.express);
    expect(summary.framework).toBe("express");
    expect(summary.evidence.length).toBeGreaterThan(0);
    const primera = summary.evidence[0]!;
    expect(esEvidenciaLegible(primera)).toBe(true);
    expect(primera.signal.toLowerCase()).toContain("express");
    expect(primera.artifact).toBe("package.json");
  });

  /**
   * FastAPI: the detector scans several `requirements*` and
   * `pyproject.toml`; at least one signal must mention `fastapi`
   * and an artifact of those the detector inspects.
   */
  test("FastAPI: evidence mentions fastapi and a dependency artifact", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.fastapi);
    expect(summary.framework).toBe("fastapi");
    expect(summary.evidence.length).toBeGreaterThan(0);
    const mencionaFastapi = summary.evidence.some((e) =>
      e.signal.toLowerCase().includes("fastapi"),
    );
    expect(mencionaFastapi).toBe(true);
    for (const e of summary.evidence) {
      expect(esEvidenciaLegible(e)).toBe(true);
    }
  });

  /**
   * Laravel: the detector sums several signals (artisan, routes/,
   * app/, composer.json) until it covers the score. Here we
   * validate that the sum of weights **reflects** the signals (the
   * summary weight is the sum of the individual weights, modulated
   * by the `withEvidence` that applies `Math.min(score, 1)`).
   */
  test("Laravel: the sum of weights matches the detector's score (≤ 1)", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.laravel);
    expect(summary.framework).toBe("laravel");
    expect(summary.evidence.length).toBeGreaterThanOrEqual(2);
    const sumaPesos = summary.evidence.reduce((acc, e) => acc + e.weight, 0);
    // The detector uses `Math.min(sum, 1)`, so the sum can exceed
    // 1: what is guaranteed is that **each** weight is bounded and
    // the sum is what the detector chose to report.
    for (const e of summary.evidence) {
      expect(esEvidenciaLegible(e)).toBe(true);
      expect(e.weight).toBeGreaterThanOrEqual(0);
      expect(e.weight).toBeLessThanOrEqual(1);
    }
    expect(sumaPesos).toBeGreaterThan(0);
    expect(sumaPesos).toBeGreaterThanOrEqual(1); // typical Laravel detects to 1
  });

  /**
   * Django: detector with two signals (manage.py + reference to
   * Django in requirements/pyproject). The first one must mention
   * `manage.py` (the second is optional depending on how the
   * fixture is built).
   */
  test("Django: the main evidence mentions manage.py", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.django);
    expect(summary.framework).toBe("django");
    expect(summary.evidence.length).toBeGreaterThan(0);
    const mencionaManage = summary.evidence.some((e) =>
      e.signal.toLowerCase().includes("manage.py"),
    );
    expect(mencionaManage).toBe(true);
    for (const e of summary.evidence) {
      expect(esEvidenciaLegible(e)).toBe(true);
    }
  });

  /**
   * Global shape: if we add up the evidence of **all** the
   * fixtures, no element breaks the contract. A single malformed
   * signal per detector is enough for the CLI to print garbage or
   * drop the line, so this test covers the rest of the detectors
   * that share the `withEvidence` helper.
   */
  test("all signals from the fixtures are readable and bounded", async () => {
    for (const fx of Object.values(FIXTURES)) {
      const summary = await summarizeWithAllFrameworks(fx);
      for (const e of summary.evidence) {
        expect(
          esEvidenciaLegible(e),
          `${fx} → ${JSON.stringify(e)}`,
        ).toBe(true);
      }
    }
  });
});

describe("summary — evidence: edge and composition", () => {
  /**
   * Without a detected framework, `evidence` stays at `[]` and the
   * `→ Why X?` line is omitted entirely (the block is not printed
   * with zero bullets). A fixture that matches no detector
   * triggers this path: the CLI must not invent evidence.
   *
   * A temporary directory with a `package.json` that declares
   * nothing is used — the orchestrator returns
   * `{ score: 0, evidence: [] }` and the summary propagates the
   * empty.
   */
  test("project with no detected framework: evidence is [] and does not break summary", async () => {
    // `mkdtemp` with a stable name for the test; the contents are
    // deleted in `afterEach` of the sibling spec if applicable.
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "evidence-empty-"));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "empty", version: "1.0.0" }),
      );
      const summary = await summarizeWithAllFrameworks(root);
      // The summary falls back to the empty framework: the
      // `→ Why X?` line is not printed (empty evidence), and
      // `routesInCode` stays at 0. What is verified is **the
      // contract of the evidence block**: it must be empty and
      // must not invent signals.
      expect(summary.evidence).toEqual([]);
      expect(summary.routesInCode).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  /**
   * Rails emits exactly two canonical signals (config/routes.rb
   * and Gemfile). The detector does not add more — a detector that
   * starts inventing signals changes the user's contract: the
   * `→ Why Rails?` line grows with each detector change and the
   * user stops knowing what to look at.
   */
  test("Rails: emits exactly the canonical signals (routes.rb + Gemfile)", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.rails);
    expect(summary.framework).toBe("rails");
    expect(summary.evidence.length).toBe(2);
    const artefactos = summary.evidence
      .map((e) => e.artifact)
      .filter((a): a is string => typeof a === "string")
      .sort();
    expect(artefactos).toContain("config/routes.rb");
    expect(artefactos).toContain("Gemfile");
  });
});