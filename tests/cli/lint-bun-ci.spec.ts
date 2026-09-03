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

  test("rechaza versiones no fijas y comentarios inline no los ocultan", () => {
    const problems = findBunCiProblems(`
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest # debe fijarse
    `);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("semver concreta");
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

  test("ignora comentarios y texto incidental fuera de comandos run", () => {
    expect(
      findBunCiProblems(`
        # bun install
        - name: Nota
          description: "bun install"
        - run: echo "bun install"
      `),
    ).toEqual([]);
  });

  test("detecta instalaciones en bloques run y aunque no haya setup-bun", () => {
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