import { describe, expect, test } from "vitest";

import { findBunCiProblems } from "../../scripts/gates/lint-bun-ci.script";

describe("lint:bun-ci", () => {
  test("rejects bun-version: latest", () => {
    const problems = findBunCiProblems(`
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
    `);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("versión concreta");
  });

  test("rejects unpinned versions and inline comments do not hide them", () => {
    const problems = findBunCiProblems(`
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest # debe fijarse
    `);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("semver concreta");
  });

  test("rejects bun install without frozen lockfile", () => {
    const problems = findBunCiProblems(`
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install
    `);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("--frozen-lockfile");
  });

  test("accepts a pinned version and a frozen install", () => {
    const problems = findBunCiProblems(`
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
    `);

    expect(problems).toEqual([]);
  });

  test("ignores a workflow that does not configure Bun", () => {
    expect(findBunCiProblems("- run: npm test")).toEqual([]);
  });

  test("ignores comments and incidental text outside run commands", () => {
    expect(
      findBunCiProblems(`
        # bun install
        - name: Nota
          description: "bun install"
        - run: echo "bun install"
      `),
    ).toEqual([]);
  });

  test("detects installs in run blocks even without setup-bun", () => {
    const problems = findBunCiProblems(`
      jobs:
        test:
          steps:
            - run: |
                bun install
                bun test
    `);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("--frozen-lockfile");
  });
});