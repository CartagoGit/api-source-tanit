/**
 * The repo's route registry.
 *
 * This spec is the reason `root.helper.ts` exists. The registry by
 * itself fixes nothing: it would be another place where a path can
 * silently go stale. What fixes it is **checking that everything it
 * declares exists**, so that moving a folder breaks the gate instead
 * of leaving a lint saying "no proposal found" as if the repo were
 * empty.
 *
 * That happened three times during the reorganization, and all three
 * were silent: a wrong path does not throw, it simply does not find.
 */
import { describe, expect, test } from "vitest";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import {
  CLI_ENTRYPOINT,
  EXAMPLES_DIR,
  DELENDAI_INTEGRATION_DIR,
  PROPOSALS_DIR,
  REPO_ROOT,
  WELL_KNOWN_PATHS,
  comprehensiveFixtureDir,
  exampleDir,
  fromRoot,
  integrationDir,
  smokeFixtureDir,
} from "../../scripts/helpers/root.helper";
import { FRAMEWORK_IDS } from "../../packages/contracts/constants/frameworks/framework-ids.constant";

describe("WELL_KNOWN_PATHS", () => {
  // The test that matters: if someone moves a folder and does not
  // update the registry, this fails naming the exact constant.
  test.each(Object.entries(WELL_KNOWN_PATHS))("%s exists on disk", (_name, path) => {
    expect(existsSync(path)).toBe(true);
  });

  test("all are absolute", () => {
    for (const [name, path] of Object.entries(WELL_KNOWN_PATHS)) {
      expect(isAbsolute(path), name).toBe(true);
    }
  });

  test("all hang off the repo root", () => {
    for (const [name, path] of Object.entries(WELL_KNOWN_PATHS)) {
      expect(path.startsWith(REPO_ROOT), `${name} = ${path}`).toBe(true);
    }
  });

  test("no two constants point to the same place", () => {
    const paths = Object.values(WELL_KNOWN_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("REPO_ROOT", () => {
  // The search requires package.json AND delendai.config.json together:
  // with only the first it would stop at the Delendai integration
  // folder (`integrations/delendai/`, moved there by x00041), which
  // also has its own.
  test("is the real root, not one of an inner package", () => {
    expect(existsSync(join(REPO_ROOT, "package.json"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "delendai.config.json"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "packages"))).toBe(true);
  });

  test("the Delendai integration also has package.json, and it is not the root", () => {
    expect(
      existsSync(join(DELENDAI_INTEGRATION_DIR, "package.json")),
    ).toBe(true);
    expect(DELENDAI_INTEGRATION_DIR).not.toBe(REPO_ROOT);
  });
});

describe("fromRoot", () => {
  test("composes from the root", () => {
    expect(fromRoot("docs")).toBe(join(REPO_ROOT, "docs"));
  });

  test("accepts multiple segments", () => {
    expect(fromRoot("packages", "core")).toBe(join(REPO_ROOT, "packages", "core"));
  });

  test("with no segments returns the root", () => {
    expect(fromRoot()).toBe(REPO_ROOT);
  });
});

describe("parameterized paths", () => {
  test("the CLI entrypoint is a file, not a folder", () => {
    expect(statSync(CLI_ENTRYPOINT).isFile()).toBe(true);
  });

  test.each([...FRAMEWORK_IDS])(
    "%s has its comprehensive fixture and its smoke fixture",
    (framework) => {
      expect(existsSync(comprehensiveFixtureDir(framework)), "comprehensive").toBe(true);
      expect(existsSync(smokeFixtureDir(framework)), "smoke").toBe(true);
    },
  );

  test.each([...FRAMEWORK_IDS])("%s has its example project", (framework) => {
    // `openapi` is the only one whose example does not follow the
    // name pattern: it is called `example-openapi-headers` because
    // what it exercises is the spec headers.
    const expected = framework === "openapi" ? join(EXAMPLES_DIR, "example-openapi-headers") : exampleDir(framework);
    expect(existsSync(expected), expected).toBe(true);
  });

  test("integrationDir composes under integrations/", () => {
    expect(integrationDir("delendai")).toBe(DELENDAI_INTEGRATION_DIR);
  });

  test("the proposals are where the registry says", () => {
    expect(existsSync(join(PROPOSALS_DIR, "ready"))).toBe(true);
    expect(existsSync(join(PROPOSALS_DIR, "done"))).toBe(true);
  });
});
