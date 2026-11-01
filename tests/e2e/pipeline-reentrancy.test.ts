/**
 * Pipeline reentrancy: two projects in the same process.
 *
 * The singleton removed from `paths.service` (r00010 S2, 2026-09-03)
 * resolved the project root **once per process** and cached it. It was
 * fine for the CLI, which spawns one process per project, but it broke
 * any long-lived consumer — the MCP server, the gate, the test suite
 * itself: the second project analyzed received the configuration and
 * routes of the first.
 *
 * It was also the root cause of the Laravel FormRequest provider bug,
 * which ignored `match.projectRoot` and read the singleton.
 */
import { describe, expect, test } from "vitest";
import { join, } from "node:path";
import { generateCollectionsWithAllFrameworks } from "../../packages/frameworks/index";

// Legacy helper: the old tests assumed the singular facade. We
// switch to the plural one (audit 2026-09-06 §3.3) and unwrap the
// single-service case here. If the fixture ever becomes a real
// multi-service monorepo this helper must be removed and the
// assertions updated.
async function generateWithAllFrameworks(
  root: string,
  options: Parameters<typeof generateCollectionsWithAllFrameworks>[1] = {},
) {
  const results = await generateCollectionsWithAllFrameworks(root, options);
  if (results.length !== 1) {
    throw new Error(
      `pipeline-reentrancy test helper expected exactly 1 result, got ${results.length}`,
    );
  }
  return results[0]!;
}
import { FIXTURES_DIR } from "../../scripts/helpers/root.helper";

const FIXTURES = FIXTURES_DIR;

const EXPRESS = join(FIXTURES, "express-comprehensive");
const DJANGO = join(FIXTURES, "django-comprehensive");
const LARAVEL = join(FIXTURES, "laravel-comprehensive");

describe("reentrant pipeline", () => {
  test("two projects in a row each detect their own framework", async () => {
    const first = await generateWithAllFrameworks(EXPRESS);
    const second = await generateWithAllFrameworks(DJANGO);

    expect(first.match?.framework).toBe("express");
    expect(second.match?.framework).toBe("django");
  });

  test("the second project does not inherit the routes of the first", async () => {
    const first = await generateWithAllFrameworks(EXPRESS);
    const second = await generateWithAllFrameworks(DJANGO);

    expect(second.metrics.routes).not.toBe(first.metrics.routes);
    expect(second.match?.projectRoot).toBe(DJANGO);
  });

  test("going back to the first yields the same result as the first time", async () => {
    const before = await generateWithAllFrameworks(EXPRESS);
    await generateWithAllFrameworks(DJANGO);
    const after = await generateWithAllFrameworks(EXPRESS);

    expect(after.metrics.routes).toBe(before.metrics.routes);
    expect(after.collection.info._postman_id).toBe(before.collection.info._postman_id!);
  });

  test("each collection keeps its own identity", async () => {
    const express = await generateWithAllFrameworks(EXPRESS);
    const django = await generateWithAllFrameworks(DJANGO);

    expect(express.collection.info._postman_id).not.toBe(
      django.collection.info._postman_id,
    );
  });

  // The Laravel FormRequest provider read the root from the singleton
  // instead of from `match.projectRoot`: without POSTMAN_PROJECT_ROOT it
  // resolved none, and after analyzing another project it resolved
  // those from the previous project.
  test("Laravel FormRequests resolve after analyzing another project", async () => {
    await generateWithAllFrameworks(EXPRESS);
    const laravel = await generateWithAllFrameworks(LARAVEL);

    expect(laravel.match?.framework).toBe("laravel");
    expect(laravel.metrics.withValidation).toBeGreaterThan(0);
  });

  test("the analysis order does not change the Laravel result", async () => {
    const alone = await generateWithAllFrameworks(LARAVEL);
    await generateWithAllFrameworks(DJANGO);
    const afterOther = await generateWithAllFrameworks(LARAVEL);

    expect(afterOther.metrics.withValidation).toBe(alone.metrics.withValidation);
    expect(afterOther.metrics.routes).toBe(alone.metrics.routes);
  });

  test("does not leave POSTMAN_PROJECT_ROOT touched when finished", async () => {
    const before = process.env["POSTMAN_PROJECT_ROOT"];
    await generateWithAllFrameworks(EXPRESS);
    expect(process.env["POSTMAN_PROJECT_ROOT"]).toBe(before);
  });

  test("restores the environment even if the pipeline throws", async () => {
    const before = process.env["POSTMAN_PROJECT_ROOT"];
    await generateWithAllFrameworks(join(FIXTURES, "no-existe")).catch(() => undefined);
    expect(process.env["POSTMAN_PROJECT_ROOT"]).toBe(before);
  });
});
