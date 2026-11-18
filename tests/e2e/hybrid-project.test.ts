/**
 * Projects that use more than one framework at the same time.
 *
 * This is a real and common API shape — a legacy Express that keeps
 * serving the old API while new routes are written in Next.js — and the
 * pipeline handled it badly: the orchestrator scored both detectors,
 * kept the one with the higher score, and discarded the other. The
 * fixture here has 6 endpoints and returned 3, without a single warning.
 *
 * Output being incomplete is bad; output being incomplete **and looking
 * correct** is worse: whoever imports it into Postman has no way to know
 * half the API is missing.
 */
import { describe, expect, test } from "vitest";
import { resolve } from "node:path";

import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import { FIXTURES_DIR } from "../../scripts/helpers/root.helper";

const FIXTURES = FIXTURES_DIR;
const HYBRID = resolve(FIXTURES, "hybrid-express-nextjs");

/** All URIs of the collection, as `METHOD /path`. */
function endpointsOf(specs: ReadonlyArray<{ method: string; uri: string }>): string[] {
  return specs.map((spec) => `${spec.method} ${spec.uri}`).sort();
}

describe("hybrid express + nextjs project", () => {
  test("recognizes BOTH frameworks, not only the highest-scoring one", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    expect(result.frameworks).toContain("nextjs");
    expect(result.frameworks).toContain("express");
    expect(result.frameworks.length).toBe(2);
  });

  // The regression: previously this returned 3 (only the Next.js ones).
  test("finds endpoints from both, not from one", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    const found = endpointsOf(result.specs);

    // From the legacy Express.
    expect(found.some((e) => e.includes("/api/legacy/users"))).toBe(true);
    // From the new Next.js.
    expect(found.some((e) => e.includes("/api/health"))).toBe(true);
    expect(found.some((e) => e.includes("/api/reports"))).toBe(true);
  });

  test("the 6 endpoints from the fixture end up in the collection", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    // express: GET/POST/DELETE on legacy/users · nextjs: health GET,
    // reports GET and POST.
    expect(result.specs.length).toBe(6);
  });

  test("warns that the project is hybrid", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    expect(result.warnings.length).toBeGreaterThan(0);
    const combined = result.warnings.join(" ");
    expect(combined).toMatch(/2 frameworks/);
    expect(combined).toMatch(/nextjs/);
    expect(combined).toMatch(/express/);
  });

  test("the warning says what to do, not only what happened", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    expect(result.warnings.join(" ")).toMatch(/--project-root/);
  });

  test("the collection remains valid and has a stable id", async () => {
    const first = await generateWithAllFrameworks(HYBRID);
    const second = await generateWithAllFrameworks(HYBRID);
    expect(first.collection.info._postman_id).toBe(second.collection.info._postman_id);
    expect(first.collection.info.schema).toContain("2.1.0");
  });

  test("does not repeat an endpoint declared by both frameworks", async () => {
    const result = await generateWithAllFrameworks(HYBRID);
    const found = endpointsOf(result.specs);
    expect(new Set(found).size).toBe(found.length);
  });
});

describe("single-framework projects", () => {
  // Scanning every candidate cannot change anything for projects that
  // already use one framework: the 12 examples match a single detector.
  test.each([
    ["express-comprehensive", "express"],
    ["nextjs-comprehensive", "nextjs"],
    ["laravel-comprehensive", "laravel"],
    ["django-comprehensive", "django"],
  ])("%s keeps detecting only %s, with no warnings", async (fixture, framework) => {
    const result = await generateWithAllFrameworks(resolve(FIXTURES, fixture));
    expect(result.frameworks).toEqual([framework]);
    expect(result.warnings).toEqual([]);
  });
});
