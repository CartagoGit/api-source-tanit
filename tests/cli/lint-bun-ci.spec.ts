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

/**
 * x00050: la versión mínima la fija el `lockfileVersion` del
 * `bun.lock` del repo. Bun 1.3.x no puede leer lockfile v2 y la CI
 * moría en `bun install --frozen-lockfile` con "Unknown lockfile
 * version" antes de correr ningún gate.
 */
describe("lint:bun-ci — versión mínima por lockfileVersion (x00050)", () => {
  test("rechaza bun < mínimo cuando el lockfile lo exige", () => {
    const problems = findBunCiProblems(
      `
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
    `,
      "1.4.0",
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("no sabe leer el lockfile");
    expect(problems[0]?.detail).toContain("1.4.0");
  });

  test("acepta bun ≥ mínimo", () => {
    expect(
      findBunCiProblems(
        `
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
    `,
        "1.4.0",
      ),
    ).toEqual([]);
  });

  test("acepta bun exactamente igual al mínimo", () => {
    expect(
      findBunCiProblems(
        `
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.0
      - run: bun install --frozen-lockfile
    `,
        "1.4.0",
      ),
    ).toEqual([]);
  });

  test("sin mínimo declarado, cualquier versión concreta pasa", () => {
    expect(
      findBunCiProblems(`
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
    `),
    ).toEqual([]);
  });
  test("readLockfileVersion lee la versión del bun.lock del repo", async () => {
    const { readLockfileVersion } = await import(
      "../../scripts/gates/lint-bun-ci.script"
    );
    // El repo tiene lockfile v2 (configVersion 1). Si un día se
    // regenera a otra versión, el gate lo recoge automáticamente.
    const version = await readLockfileVersion();
    expect(version).toBe(2);
  });
});