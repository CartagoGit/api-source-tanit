import { describe, expect, test } from "vitest";

import { findBunCiProblems } from "../../scripts/gates/lint-bun-ci.script";

describe("lint:bun-ci", () => {
  test("rechaza bun-version: latest", () => {
    const problems = findBunCiProblems(`
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
    `);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("versión concreta");
  });

  test("rechaza bun install sin lockfile congelado", () => {
    const problems = findBunCiProblems(`
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install
    `);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("--frozen-lockfile");
  });

  test("acepta una versión fija y una instalación congelada", () => {
    const problems = findBunCiProblems(`
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
    `);

    expect(problems).toEqual([]);
  });

  test("ignora un workflow que no configura Bun", () => {
    expect(findBunCiProblems("- run: npm test")).toEqual([]);
  });
});