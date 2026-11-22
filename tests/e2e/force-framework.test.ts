/**
 * Telling the tool which framework the API uses.
 *
 * Auto-detection relies on manifests, and there are project shapes where
 * it **cannot** get it right:
 *
 *   - A monorepo where the `package.json` is at the root and the API in
 *     `services/api/`, so pointing at the API yields no manifest.
 *   - An aliased dependency, or a fork with a different package name.
 *   - A manifest that is generated at build time and not in the repo.
 *
 * In all of these, the runner **knows** which framework their API uses.
 * Not being able to say so turned a solvable case into a dead end, with
 * a message that sounded like "not supported" when in fact it was.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";
import { FRAMEWORK_IDS } from "../../packages/contracts/constants/frameworks/framework-ids.constant";

/** Copy of the Fastify fixture WITHOUT its `package.json`. */
let sinManifiesto = "";
let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "force-framework-"));
  sinManifiesto = join(workDir, "api");
  await cp(comprehensiveFixtureDir("fastify"), sinManifiesto, { recursive: true });
  await unlink(join(sinManifiesto, "package.json"));
}, 60_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe("without a manifest there is no possible detection", () => {
  test("without forcing, it does not recognize anything and says so", async () => {
    const result = await generateWithAllFrameworks(sinManifiesto);
    expect(result.frameworks).toEqual([]);
    expect(result.metrics.specs).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("forcing the framework, it finds the endpoints", async () => {
    const result = await generateWithAllFrameworks(sinManifiesto, {
      forceFramework: "fastify",
    });
    expect(result.match?.framework).toBe("fastify");
    expect(result.metrics.specs).toBeGreaterThan(5);
  });

  test("forcing also resolves the validation rules", async () => {
    const result = await generateWithAllFrameworks(sinManifiesto, {
      forceFramework: "fastify",
    });
    expect(result.metrics.withValidation).toBeGreaterThan(0);
  });
});

describe("an id that does not exist", () => {
  // Fails BEFORE scanning: a mistyped id discovered at the end, after
  // walking the project with zero endpoints, says nothing about what
  // actually happened.
  test("fails instantly", async () => {
    await expect(
      generateWithAllFrameworks(sinManifiesto, { forceFramework: "inventado" }),
    ).rejects.toThrow(/No scanner for/);
  });

  test("the error lists the available frameworks", async () => {
    await expect(
      generateWithAllFrameworks(sinManifiesto, { forceFramework: "inventado" }),
    ).rejects.toThrow(/fastify/);
  });
});

describe("forcing changes nothing when detection already matches", () => {
  test.each([...FRAMEWORK_IDS])(
    "%s yields the same detected vs. forced",
    async (framework) => {
      const root = comprehensiveFixtureDir(framework);
      const detectado = await generateWithAllFrameworks(root);
      const forzado = await generateWithAllFrameworks(root, { forceFramework: framework });
      expect(forzado.metrics.specs).toBe(detectado.metrics.specs);
      expect(forzado.match?.framework).toBe(framework);
    },
  );
});
