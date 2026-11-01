import { describe, expect, test } from "vitest";

import {
  computeOrphans,
  toBarePackageName,
} from "../../scripts/gates/lint-no-orphan-types.script";

describe("lint:no-orphan-types — normalización @types/* (x00053 S3)", () => {
  describe("toBarePackageName", () => {
    test("strips the @types/ prefix", () => {
      expect(toBarePackageName("@types/node")).toBe("node");
      expect(toBarePackageName("@types/chai")).toBe("chai");
      expect(toBarePackageName("@types/deep-eql")).toBe("deep-eql");
      expect(toBarePackageName("@types/estree")).toBe("estree");
    });

    test("strips a single @ from scoped packages", () => {
      expect(toBarePackageName("@scope/pkg")).toBe("scope/pkg");
      expect(toBarePackageName("@babel/parser")).toBe("babel/parser");
    });

    test("leaves non-scoped, non-@types names untouched", () => {
      expect(toBarePackageName("vitest")).toBe("vitest");
      expect(toBarePackageName("@vitest/coverage-v8")).toBe("vitest/coverage-v8");
    });

    test("does not match @type without trailing slash (no false positive)", () => {
      // The @types/X rule must not also fire on @type or @typefoo.
      expect(toBarePackageName("@type")).toBe("type");
      expect(toBarePackageName("@typefoo")).toBe("typefoo");
    });
  });

  describe("computeOrphans", () => {
    test("does NOT flag a @types/X package that is declared in package.json", () => {
      // Before x00053 S2, this was the bug: installed has bare names
      // ("node"), declared has full names ("@types/node"). The two
      // sets never matched, so every legitimate @types/X declared
      // was reported as orphan.
      const installed = ["node", "chai", "deep-eql", "estree"];
      const declared = ["@types/node", "vitest"];

      const orphans = computeOrphans(installed, declared);

      expect(orphans).toContain("chai");
      expect(orphans).toContain("deep-eql");
      expect(orphans).toContain("estree");
      expect(orphans).not.toContain("node");
    });

    test("flags a hoisted @types/X that is NOT declared anywhere", () => {
      const installed = ["node", "ghost"];
      const declared = ["@types/node", "vitest"];

      const orphans = computeOrphans(installed, declared);

      expect(orphans).toEqual(["ghost"]);
    });

    test("returns empty when installed ⊆ declared (after normalization)", () => {
      const installed = ["node", "chai"];
      const declared = ["@types/node", "@types/chai", "vitest"];

      expect(computeOrphans(installed, declared)).toEqual([]);
    });

    test("treats scoped packages correctly", () => {
      const installed = ["babel/parser"];
      const declared = ["@babel/parser"];

      expect(computeOrphans(installed, declared)).toEqual([]);
    });

    test("an undeclared @types/X with mixed declared set still flags", () => {
      const installed = ["node", "lodash"];
      const declared = ["@types/node", "vitest"];

      const orphans = computeOrphans(installed, declared);

      expect(orphans).toEqual(["lodash"]);
    });
  });

  describe("integration with the real repo fixtures", () => {
    // These read the real `node_modules/@types/` and `package.json`
    // and verify the gate returns no orphan given the current state.
    // If a future change re-introduces the comparison bug, this fails
    // first — the unit tests above prove the helper, this proves the
    // wiring is wired.
    //
    // We exercise `computeOrphans` directly against the helpers'
    // public surface (the same `listInstalledTypes` / `declaredInRoot`
    // are kept internal — they touch the filesystem of this repo and
    // are not safe to export across processes).
    test("current repo state has no orphan types", async () => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const exec = promisify(execFile);
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const scriptPath = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../scripts/gates/lint-no-orphan-types.script.ts",
      );
      const child = await exec("bun", ["run", scriptPath]);
      expect(child.stdout).toMatch(/todos declarados o transitivos/);
    });
  });
});
