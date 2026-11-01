/**
 * Contract of `effectiveScanRoot` / `safeScanRoot` — a00012 S1.b.
 *
 * The helper centralizes what Hono, NestJS and Next.js were already
 * doing inline: resolve the effective scan root from
 * `match.frameworkSearchRoot`, and return `match.projectRoot` when
 * that field is absent. The difference versus the inline versions is
 * the containment guard: a `frameworkSearchRoot` with `..` must not be
 * able to take the scanner outside of `projectRoot`.
 *
 * The four cases cover the full contract:
 *
 *   1. Absent (null/undefined/empty string) → `projectRoot`.
 *   2. Relative inside the root → resolved join.
 *   3. Escape (`..` that leaves the root) → `Error` with context.
 *
 * The fourth case (empty string) was not in the original proposal,
 * but it is one of the three forms the helper treats as "absent": a
 * caller that receives an empty value from the CLI must not end up
 * with a resolution to `projectRoot + ""` (= `projectRoot`), which
 * is the correct behavior, but it is also the only observable
 * difference between `""` and `undefined`, and worth pinning down.
 *
 * `tsconfig.base.json` has `allowImportingTsExtensions: false`, so
 * the import goes without the `.ts` extension (same pattern as the
 * rest of `tests/frameworks/*.spec.ts`).
 */
import { describe, expect, test } from "vitest";

import {
  effectiveScanRoot,
  safeScanRoot,
} from "../../packages/core/discovery/scan-root.helper";

function matchWith(
  frameworkSearchRoot: string | null | undefined,
  projectRoot = "/tmp/mono",
  framework = "fastify",
): Parameters<typeof effectiveScanRoot>[0] {
  // The helper only reads `projectRoot`, `frameworkSearchRoot` and
  // `framework` from the match. Building an ad-hoc object keeps the
  // test free of the full `IProjectMatch` shape, which adds nothing
  // to the contract being tested here.
  const match = {
    framework,
    projectRoot,
    artifacts: [] as ReadonlyArray<string>,
  };
  // `IProjectMatch.frameworkSearchRoot` is typed as `string | undefined`
  // (not `null`); the helper does treat `null` as absent for symmetry
  // with the real call sites (CLI / plugin), but the type contract does
  // not include `null`. We normalize here so the test speaks the same
  // language as the interface.
  if (frameworkSearchRoot === undefined || frameworkSearchRoot === null) {
    return match;
  }
  return { ...match, frameworkSearchRoot };
}

describe("effectiveScanRoot", () => {
  test("absent frameworkSearchRoot → projectRoot (untouched)", () => {
    const projectRoot = "/tmp/mono";
    expect(effectiveScanRoot(matchWith(undefined, projectRoot))).toBe(
      projectRoot,
    );
    expect(effectiveScanRoot(matchWith(null, projectRoot))).toBe(projectRoot);
  });

  test("frameworkSearchRoot = 'apps/api' → /tmp/mono/apps/api", () => {
    expect(effectiveScanRoot(matchWith("apps/api"))).toBe("/tmp/mono/apps/api");
  });

  test("frameworkSearchRoot = '' → projectRoot (empty string ≡ absent)", () => {
    const projectRoot = "/tmp/mono";
    expect(effectiveScanRoot(matchWith("", projectRoot))).toBe(projectRoot);
  });

  test("frameworkSearchRoot = '../escape' → throws with match context", () => {
    const projectRoot = "/tmp/mono";
    const framework = "fastify";
    expect(() =>
      effectiveScanRoot(matchWith("../escape", projectRoot, framework)),
    ).toThrowError(/frameworkSearchRoot inválido[\s\S]*fastify[\s\S]*\/tmp\/mono/);
  });
});

describe("safeScanRoot (alias of effectiveScanRoot)", () => {
  test("same behavior with a present value: 'apps/api'", () => {
    expect(safeScanRoot(matchWith("apps/api"))).toBe("/tmp/mono/apps/api");
  });

  test("same behavior with an absent value: projectRoot", () => {
    const projectRoot = "/tmp/mono";
    expect(safeScanRoot(matchWith(undefined, projectRoot))).toBe(projectRoot);
  });

  test("same behavior with an escape: throws", () => {
    expect(() => safeScanRoot(matchWith("../escape"))).toThrowError(
      /frameworkSearchRoot inválido/,
    );
  });
});
