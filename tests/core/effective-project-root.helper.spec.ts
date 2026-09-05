/**
 * Contract of `effectiveProjectRoot` / `effectiveSearchRoot` /
 * `rawProjectRoot` — a00014 S1.
 *
 * The helper centralizes what Express, Hono, NestJS and Next.js were
 * already doing inline: resolve the effective project root from
 * `match.frameworkSearchRoot`, and return `match.projectRoot` when
 * that field is absent. The difference from the inline versions is
 * that no scanner can ignore `frameworkSearchRoot` by accident: all
 * 21 scanners now consume this primitive, and the
 * `lint:effective-project-root` gate rejects any scanner that keeps
 * reading `match.projectRoot` directly.
 *
 * The eight tests cover the full contract:
 *
 *   1. Absent (null/undefined/empty string) → `projectRoot`.
 *   2. Relative inside the root → resolved join.
 *   3. Absolute → verbatim (host's decision, not the helper's).
 *   4. Relative escape (`..` leaving the root) → `Error` with context.
 *   5. Idempotence: two consecutive calls return the same value.
 *   6. Trailing slash: `'apps/api/'` ≡ `'apps/api'`.
 *   7. Purity: the original `match` object is not mutated after the
 *      call.
 *   8. Repetition with `effectiveSearchRoot` (alias): same semantics.
 *
 * `tsconfig.base.json` has `allowImportingTsExtensions: false`, so the
 * import omits the `.ts` extension (same pattern as the rest of
 * `tests/core/*.spec.ts`).
 */
import { describe, expect, test } from "vitest";

import {
  effectiveProjectRoot,
  effectiveSearchRoot,
  rawProjectRoot,
} from "../../packages/core/discovery/effective-project-root.helper";

function matchWith(
  frameworkSearchRoot: string | null | undefined,
  projectRoot = "/tmp/mono",
  framework = "fastify",
): Parameters<typeof effectiveProjectRoot>[0] {
  // The helper only reads `projectRoot`, `frameworkSearchRoot` and
  // `framework` from the match. Building an ad-hoc object keeps the
  // test free of the full `IProjectMatch` shape, which adds nothing
  // to the contract being tested here.
  const match = {
    framework,
    projectRoot,
    artifacts: [] as ReadonlyArray<string>,
  };
  // `IProjectMatch.frameworkSearchRoot` is typed as `string |
  // undefined` (not `null`); the helper does treat `null` as absent
  // for symmetry with the real call sites (CLI / plugin), but the
  // type contract does not include `null`. We normalize here so the
  // test speaks the same language as the interface.
  if (frameworkSearchRoot === undefined || frameworkSearchRoot === null) {
    return match;
  }
  return { ...match, frameworkSearchRoot };
}

describe("effectiveProjectRoot", () => {
  test("absent frameworkSearchRoot → projectRoot (untouched)", () => {
    const projectRoot = "/tmp/mono";
    expect(effectiveProjectRoot(matchWith(undefined, projectRoot))).toBe(
      projectRoot,
    );
    expect(effectiveProjectRoot(matchWith(null, projectRoot))).toBe(
      projectRoot,
    );
  });

  test("frameworkSearchRoot = 'apps/api' → /tmp/mono/apps/api", () => {
    expect(effectiveProjectRoot(matchWith("apps/api"))).toBe(
      "/tmp/mono/apps/api",
    );
  });

  test("absolute frameworkSearchRoot → throws (a00014 S4: contract says 'never absolute')", () => {
    expect(() =>
      effectiveProjectRoot(matchWith("/srv/shared")),
    ).toThrowError(/frameworkSearchRoot inválido[\s\S]*absoluta[\s\S]*relativa/);
    expect(() =>
      effectiveProjectRoot(matchWith("/etc")),
    ).toThrowError(/frameworkSearchRoot inválido/);
    // The trap-prefix case (x00022): '/tmp/mono-mala' starts with
    // '/tmp/mono' but is not inside it. Because it is absolute, the
    // isAbsolute guard rejects it before the comparison runs.
    expect(() =>
      effectiveProjectRoot(matchWith("/tmp/mono-mala")),
    ).toThrowError(/frameworkSearchRoot inválido/);
  });

  test("frameworkSearchRoot = '' → projectRoot (empty string ≡ absent)", () => {
    const projectRoot = "/tmp/mono";
    expect(effectiveProjectRoot(matchWith("", projectRoot))).toBe(projectRoot);
  });

  test("frameworkSearchRoot = '../escape' → throws with match context", () => {
    const projectRoot = "/tmp/mono";
    const framework = "fastify";
    expect(() =>
      effectiveProjectRoot(matchWith("../escape", projectRoot, framework)),
    ).toThrowError(
      /frameworkSearchRoot inválido[\s\S]*fastify[\s\S]*\/tmp\/mono/,
    );
  });

  test("idempotent: two consecutive calls return the same value", () => {
    const match = matchWith("apps/api");
    const first = effectiveProjectRoot(match);
    const second = effectiveProjectRoot(match);
    expect(second).toBe(first);
  });

  test("trailing slash: 'apps/api/' ≡ 'apps/api' (path.resolve normalizes)", () => {
    expect(effectiveProjectRoot(matchWith("apps/api/"))).toBe(
      "/tmp/mono/apps/api",
    );
  });

  test("pure: does not mutate the original match", () => {
    const match = matchWith("apps/api");
    const before = { ...match };
    effectiveProjectRoot(match);
    expect(match).toEqual(before);
  });
});

describe("effectiveSearchRoot (alias of effectiveProjectRoot)", () => {
  test("same behavior with a present value: 'apps/api'", () => {
    expect(effectiveSearchRoot(matchWith("apps/api"))).toBe(
      "/tmp/mono/apps/api",
    );
  });

  test("same behavior with an absolute value: throws", () => {
    expect(() => effectiveSearchRoot(matchWith("/srv/shared"))).toThrowError(
      /frameworkSearchRoot inválido/,
    );
  });

  test("same behavior with an escape: throws", () => {
    expect(() => effectiveSearchRoot(matchWith("../escape"))).toThrowError(
      /frameworkSearchRoot inválido/,
    );
  });
});

describe("rawProjectRoot (escape hatch for literal projectRoot)", () => {
  test("returns match.projectRoot as-is, without touching frameworkSearchRoot", () => {
    const projectRoot = "/tmp/mono";
    expect(rawProjectRoot(matchWith("apps/api", projectRoot))).toBe(projectRoot);
    expect(rawProjectRoot(matchWith(undefined, projectRoot))).toBe(projectRoot);
  });

  test("ignores frameworkSearchRoot even when it is absolute", () => {
    const projectRoot = "/tmp/mono";
    expect(rawProjectRoot(matchWith("/srv/shared", projectRoot))).toBe(
      projectRoot,
    );
  });
});
