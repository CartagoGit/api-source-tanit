/**
 * Two analyses at the same time in the same process.
 *
 * This is not a laboratory case: the MCP server is a long-lived process
 * and may receive two overlapping requests from an agent. The pipeline
 * depended on **global** state — `withProjectRoot()` saved
 * `process.env.POSTMAN_PROJECT_ROOT` and a module cache, overwrote
 * them, ran, and restored them.
 *
 * With two concurrent calls that breaks: the second overwrites the
 * value while the first is still running, and when the first finishes
 * it restores the previous state, leaving the second looking at the
 * wrong root.
 *
 * It was caught by comparing `summary` with `generate` on the same
 * project launched with `Promise.all`: 16 and 17 endpoints where
 * sequentially both return 18. Neither number was correct.
 */
import { describe, expect, test } from "vitest";

import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";

/** What analyzing a fixture alone yields — the reference truth. */
async function baseline(framework: string): Promise<number> {
  const result = await generateWithAllFrameworks(comprehensiveFixtureDir(framework));
  return result.metrics.specs;
}

describe("pipeline bajo concurrencia", () => {
  test("two DISTINCT projects at once do not mix", async () => {
    const [django, laravel] = [await baseline("django"), await baseline("laravel")];

    const [a, b] = await Promise.all([
      generateWithAllFrameworks(comprehensiveFixtureDir("django")),
      generateWithAllFrameworks(comprehensiveFixtureDir("laravel")),
    ]);

    expect(a.match?.framework).toBe("django");
    expect(b.match?.framework).toBe("laravel");
    expect(a.metrics.specs).toBe(django);
    expect(b.metrics.specs).toBe(laravel);
  });

  test("the same project twice at once yields the same", async () => {
    const expected = await baseline("express");
    const results = await Promise.all([
      generateWithAllFrameworks(comprehensiveFixtureDir("express")),
      generateWithAllFrameworks(comprehensiveFixtureDir("express")),
    ]);
    for (const result of results) expect(result.metrics.specs).toBe(expected);
  });

  test("six at once, all correct", async () => {
    const frameworks = ["laravel", "django", "express", "fastapi", "nestjs", "gin"];
    const expected = new Map<string, number>();
    for (const framework of frameworks) expected.set(framework, await baseline(framework));

    const results = await Promise.all(
      frameworks.map((framework) =>
        generateWithAllFrameworks(comprehensiveFixtureDir(framework)),
      ),
    );

    results.forEach((result, index) => {
      const framework = frameworks[index]!;
      expect(result.match?.framework, framework).toBe(framework);
      expect(result.metrics.specs, framework).toBe(expected.get(framework));
    });
  });

  // The queue must not break because one call fails: if the rejected
  // promise were chained, the next one would inherit the failure and
  // the process would become unusable.
  test("a failure does not poison the following calls", async () => {
    const expected = await baseline("flask");

    await expect(
      generateWithAllFrameworks("/tmp/__no_existe_para_la_cola__"),
    ).rejects.toThrow();

    const after = await generateWithAllFrameworks(comprehensiveFixtureDir("flask"));
    expect(after.metrics.specs).toBe(expected);
  });

  test("the collection identity holds under concurrency", async () => {
    const [a, b] = await Promise.all([
      generateWithAllFrameworks(comprehensiveFixtureDir("symfony")),
      generateWithAllFrameworks(comprehensiveFixtureDir("symfony")),
    ]);
    expect(a.collection.info._postman_id).toBe(b.collection.info._postman_id);
  });
});
