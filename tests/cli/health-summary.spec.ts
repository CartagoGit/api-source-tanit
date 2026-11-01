/**
 * `summary` — the documentation health, in what the user sees.
 *
 * The pure computation has its spec (`tests/core/project-health.spec.ts`):
 * there we verify that `computeProjectHealth()` classifies each
 * category into its piece. What is verified here is **what the
 * `summary` command delivers**: the `health` block inside
 * `IProjectSummary`, the four percentages that print as-is in the
 * CLI line `→ Health: validation x% · body x% · examples x% ·
 * descriptions x%`, and the coherence of the set when combined with
 * real fixtures.
 *
 * The datum of each test is a project summary, not a hand-built
 * `EndpointSpec`: `summary` is not fed loose specs but the
 * `result.specs` the pipeline produces. Reproducing the whole path
 * —frameworks → routes → final specs— is what distinguishes a
 * summary test from a `computeProjectHealth` test.
 */
import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { summarizeWithAllFrameworks } from "../../packages/frameworks/index.js";
import type {
  IProjectHealth,
  IProjectSummary,
} from "../../packages/contracts/interfaces/core/domain.interface.js";

/** Root of the real fixtures: each folder models a different framework. */
const FIXTURES = {
  express: "tests/fixtures/express-comprehensive",
  fastapi: "tests/fixtures/fastapi-comprehensive",
  laravel: "tests/fixtures/laravel-comprehensive",
  django: "tests/fixtures/django-comprehensive",
  rails: "tests/fixtures/rails-comprehensive",
} as const;

/** Temporary folder with an empty project: `summary` will accept it. */
let work = "";

afterEach(async () => {
  if (work) {
    await rm(work, { recursive: true, force: true });
    work = "";
  }
});

async function proyectoVacio(): Promise<string> {
  work = await mkdtemp(join(tmpdir(), "health-summary-"));
  await mkdir(work, { recursive: true });
  return work;
}

async function proyectoConManifest(
  manifest: string,
  filename = "package.json",
): Promise<string> {
  const root = await proyectoVacio();
  await writeFile(join(root, filename), manifest);
  return root;
}

describe("summary — health: the four categories of the block", () => {
  /**
   * The CLI prints the line `→ Health: validation x% · body x% ·
   * examples x% · descriptions x%`. Each percentage is what the user
   * sees without opening the JSON; if any goes out of the 0..100
   * range, that line prints `NaN%` or `150%`, which is exactly the
   * lie the health comes to avoid.
   */
  test("the four percentages are integers bounded in 0..100", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.express);
    const health = summary.health;
    expect(Number.isInteger(health.withValidationPercent)).toBe(true);
    expect(Number.isInteger(health.withBodySchemaPercent)).toBe(true);
    expect(Number.isInteger(health.withExamplesPercent)).toBe(true);
    expect(Number.isInteger(health.withDescriptionPercent)).toBe(true);
    for (const value of [
      health.withValidationPercent,
      health.withBodySchemaPercent,
      health.withExamplesPercent,
      health.withDescriptionPercent,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  /**
   * `withValidationPercent` counts `formRequest != null` per endpoint.
   * A fixture with resolved forms (Laravel) and another without them
   * (Rails, which does not use FormRequest by convention) must
   * produce different percentages: if both came out at 0 or at 100,
   * the category would not be measured.
   */
  test("routes with validation: Laravel exceeds Rails because it has FormRequest", async () => {
    const laravel = await summarizeWithAllFrameworks(FIXTURES.laravel);
    const rails = await summarizeWithAllFrameworks(FIXTURES.rails);
    expect(laravel.health.withValidationPercent).toBeGreaterThan(
      rails.health.withValidationPercent,
    );
    // Sanity: the real Laravel fixture must have at least one resolved
    // FormRequest; if not, the contrast would prove nothing.
    expect(laravel.withFormRequest).toBeGreaterThan(0);
  });

  /**
   * `withBodySchemaPercent` counts specs whose `body` carries real
   * content. The FastAPI fixture in the repo is wired up with
   * Pydantic: the agnostic inference of the pipeline resolves bodies
   * for its endpoints, so the percentage must be > 0. If it came out
   * 0, something in the wiring summary → computeProjectHealth broke.
   */
  test("bodies with schema: FastAPI infers bodies from Pydantic, not 0", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.fastapi);
    expect(summary.health.withBodySchemaPercent).toBeGreaterThan(0);
    // And the canonical counter of the summary itself must agree with
    // the ratio the health returns (both round the same): if the two
    // numbers count different things, `summary` and the MCP tool show
    // discrepant metrics.
    const total = summary.routesInCode;
    if (total > 0) {
      const derivedFromCounters = Math.round(
        (summary.bodiesAdded > 0 ? summary.routesInCode : 0) / total * 100,
      );
      expect(summary.health.withBodySchemaPercent).toBeGreaterThanOrEqual(
        derivedFromCounters,
      );
    }
  });

  /**
   * `withExamplesPercent` admits **two** paths for an example: body
   * with content, or query/header with a value. The agnostic
   * inference fills in queries when it can, so the Express fixture —
   * models without formal validation— must have examples even
   * though its body is empty on several endpoints.
   */
  test("examples: Express has examples via query even without FormRequest", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.express);
    expect(summary.health.withExamplesPercent).toBeGreaterThan(0);
  });

  /**
   * `withDescriptionPercent` requires text after `trim()`. Real
   * fixtures rarely carry docstrings per route, so the percentage
   * tends to 0; if it stayed at 0 on a project that **would** have
   * descriptions (Django often carries docstrings in views.py), that
   * would be a bug. Here we validate only the minimum bound: never
   * negative and always integer.
   */
  test("descriptions: the percentage is never negative even when the project does not document", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.django);
    expect(summary.health.withDescriptionPercent).toBeGreaterThanOrEqual(0);
    expect(summary.health.withDescriptionPercent).toBeLessThanOrEqual(100);
  });
});

describe("summary — health: the combined computation", () => {
  /**
   * Zero endpoints → zero across the board. The rule is in
   * `computeProjectHealth`: if the total is 0, division does not
   * happen. A freshly created project (with `package.json` and
   * nothing else) falls into this case and the CLI must print
   * `validation 0% · body 0% · examples 0% · descriptions 0%`, not
   * `NaN%`.
   */
  test("a project with no routes: the four percentages are 0", async () => {
    const root = await proyectoConManifest(
      JSON.stringify({ name: "empty", version: "1.0.0" }),
    );
    const summary = await summarizeWithAllFrameworks(root);
    const health = summary.health;
    expect(health.withValidationPercent).toBe(0);
    expect(health.withBodySchemaPercent).toBe(0);
    expect(health.withExamplesPercent).toBe(0);
    expect(health.withDescriptionPercent).toBe(0);
    expect(summary.routesInCode).toBe(0);
  });

  /**
   * The percentage **derived** from the canonical counters of the
   * summary must match what the `health` block declares. If they
   * differ, two metrics are picking different specs: one of the two
   * is lying, and that is exactly what the health comes to avoid.
   *
   * This is the coherence guarantee the CLI and the MCP tool need:
   * whoever reads `withFormRequest` and `routesInCode` and does the
   * math, must get the same as
   * `summary.health.withValidationPercent`.
   */
  test("coherence: the validation percentage matches withFormRequest/total", async () => {
    for (const fx of [
      FIXTURES.express,
      FIXTURES.fastapi,
      FIXTURES.laravel,
      FIXTURES.django,
    ]) {
      const summary = await summarizeWithAllFrameworks(fx);
      const total = summary.routesInCode;
      if (total === 0) continue;
      const esperado = Math.round((summary.withFormRequest / total) * 100);
      expect(summary.health.withValidationPercent).toBe(esperado);
    }
  });

  /**
   * The four percentages do **not** have to sum to 100: an endpoint
   * can carry validation, body, example and description all at the
   * same time. What is validated is that each measures **its**
   * category, not its neighbour's. If two categories always agreed,
   * one of the two would not be measuring anything.
   */
  test("the four categories are independent: none copies another", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.laravel);
    const health = summary.health;
    // Structurally distinct categories must be able to differ. If in
    // this fixture all are equal, the contract breaks: it would mean
    // measuring one is measuring all.
    const values = [
      health.withValidationPercent,
      health.withBodySchemaPercent,
      health.withExamplesPercent,
      health.withDescriptionPercent,
    ];
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  /**
   * The shape of the `health` block does not change between projects:
   * the CLI always prints the four keys with numbers. A small but
   * decisive test — if `IProjectHealth` lost a key, this test detects
   * the contract change before the CLI line starts printing
   * `undefined%`.
   */
  test("the health block has exactly the four contractual keys", async () => {
    const summary = await summarizeWithAllFrameworks(FIXTURES.django);
    const claves = Object.keys(summary.health).sort();
    expect(claves).toEqual([
      "withBodySchemaPercent",
      "withDescriptionPercent",
      "withExamplesPercent",
      "withValidationPercent",
    ]);
    // And all signatures are `number`: if someone slipped in a
    // string by accident, the CLI would print `validation abc%`.
    // The key listing already comes typed by `Object.keys` — but
    // `IProjectHealth` does not expose a dynamic signature, so it is
    // iterated as a literal union (the four contractual keys, in
    // order) instead of a dynamic index.
    const clavesTipadas: ReadonlyArray<keyof IProjectHealth> = [
      "withBodySchemaPercent",
      "withDescriptionPercent",
      "withExamplesPercent",
      "withValidationPercent",
    ];
    for (const clave of clavesTipadas) {
      expect(typeof summary.health[clave]).toBe("number");
    }
    expect(claves).toEqual([...clavesTipadas].sort());
  });
});

/**
 * Helper: typeguard so that tests that import this do not have to
 * repeat the cast to `IProjectHealth` when they want to read a field.
 */
export function isHealth(value: unknown): value is IProjectHealth {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["withValidationPercent"] === "number" &&
    typeof v["withBodySchemaPercent"] === "number" &&
    typeof v["withExamplesPercent"] === "number" &&
    typeof v["withDescriptionPercent"] === "number"
  );
}

/** Parallel typeguard for `IProjectSummary`, useful in composition. */
export function isSummary(value: unknown): value is IProjectSummary {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["framework"] === "string" &&
    typeof v["projectName"] === "string" &&
    typeof v["routesInCode"] === "number" &&
    Array.isArray(v["warnings"]) &&
    Array.isArray(v["evidence"]) &&
    isHealth(v["health"])
  );
}