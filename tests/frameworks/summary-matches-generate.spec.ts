/**
 * `summary` must anticipate what `generate` does.
 *
 * That is its entire contract: someone calls it to decide whether it is
 * worth generating. If the numbers do not match, it is useless for
 * deciding anything.
 *
 * And they did not match. `summary` had its own discovery path with a
 * hand-written list, `NON_LARAVEL_FRAMEWORKS`, that enumerated eleven
 * of the twelve frameworks. Laravel was missing, so it went down a
 * different heuristic and counted **declared** routes instead of the
 * endpoints that end up in the collection: for `examples/example-laravel`
 * it said 7 where the pipeline finds 17.
 *
 * The serious part was not the 7: it was that a parallel list of
 * frameworks goes stale on its own. A new framework would also not have
 * been on it, and would have fallen into the old path without anything
 * saying so.
 */
import { describe, expect, test } from "vitest";

import { generateWithAllFrameworks, summarizeWithAllFrameworks } from "../../packages/frameworks/index";
import {
  PROPOSALS_DIR,
  comprehensiveFixtureDir,
} from "../../scripts/helpers/root.helper";
import { FRAMEWORK_IDS } from "../../packages/contracts/constants/frameworks/framework-ids.constant";

describe("summary and generate see the same thing", () => {
  test.each([...FRAMEWORK_IDS])(
    "%s: same endpoints, same framework, same resolved rules",
    async (framework) => {
      const root = comprehensiveFixtureDir(framework);
      const [summary, generated] = await Promise.all([
        summarizeWithAllFrameworks(root),
        generateWithAllFrameworks(root),
      ]);

      expect(summary.framework).toBe(generated.match?.framework ?? "unknown");
      expect(summary.routesInCode).toBe(generated.metrics.specs);
      expect(summary.withFormRequest).toBe(generated.metrics.withValidation);
      expect(summary.withoutFormRequest).toBe(generated.metrics.withoutValidation);
      expect(summary.frameworks).toEqual(generated.frameworks);
    },
  );

  // The concrete regression: Laravel was the only one excluded from the list.
  test("laravel is not a special case", async () => {
    const summary = await summarizeWithAllFrameworks(
      comprehensiveFixtureDir("laravel"),
    );
    expect(summary.framework).toBe("laravel");
    // Well above the 7 that counting declared routes gave: an
    // `apiResource` is one line and five endpoints.
    expect(summary.routesInCode).toBeGreaterThan(10);
  });

  test("reports the login the same way as the collection", async () => {
    const root = comprehensiveFixtureDir("laravel");
    const [summary, generated] = await Promise.all([
      summarizeWithAllFrameworks(root),
      generateWithAllFrameworks(root),
    ]);
    expect(summary.auth === null).toBe(generated.authFlow?.login == null);
  });

  // A folder that EXISTS but no scanner recognizes. Returning zero
  // endpoints with a warning is the honest answer; throwing would tell
  // someone their project is broken when it is just that we cannot read
  // it.
  test("a project nobody recognizes does not blow up", async () => {
    const summary = await summarizeWithAllFrameworks(PROPOSALS_DIR);
    expect(summary.routesInCode).toBe(0);
    expect(summary.warnings.length).toBeGreaterThan(0);
  });

  test("a non-existent projectRoot does throw", async () => {
    await expect(summarizeWithAllFrameworks("/tmp/__no_existe_zzz__")).rejects.toThrow(
      /does not exist/i,
    );
  });
});
