/**
 * The sections registry.
 *
 * It is the piece that vitest, the typecheck, and `test:changed` hang
 * off, so a failure here does not break a test: it makes the gate
 * stop watching a folder without warning. That is why the mapping is
 * checked case by case and not only "it returns something".
 */
import { describe, expect, test } from "vitest";

import {
  GLOBAL_PATHS,
  SECTIONS,
  bestSectionFor,
  sectionByName,
  sectionsForFiles,
  withDependents,
} from "../../scripts/gates/sections.constant";

describe("SECTIONS", () => {
  test("names are unique", () => {
    const names = SECTIONS.map((section) => section.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every declared dependency exists", () => {
    for (const section of SECTIONS) {
      for (const dependency of section.dependsOn) {
        expect(sectionByName(dependency), `${section.name} → ${dependency}`).toBeDefined();
      }
    }
  });

  /**
   * The rule said "the core depends on no one", and that stopped
   * being true when `contracts` appeared. But it was never what we
   * meant to say: what keeps the core agnostic is that it does not
   * depend on **frameworks**, not that it depends on nothing.
   * Depending on a project that only has interfaces does not add
   * any framework on top.
   *
   * It is written as what it means so that the next nuclear section
   * does not force touching the test again.
   */
  test("the core does not depend on frameworks: that is what keeps it agnostic", () => {
    expect(sectionByName("core")?.dependsOn).not.toContain("frameworks");
  });

  /** And below contracts there is nothing: they are the base of the graph. */
  test("contracts depend on no one", () => {
    expect(sectionByName("contracts")?.dependsOn).toEqual([]);
  });

  /**
   * They all depend on contracts. It is what lets a shared type be
   * used without dragging along the implementation that premiered
   * it.
   */
  test("all other sections depend on contracts", () => {
    for (const section of SECTIONS) {
      if (section.name === "contracts") continue;
      expect(section.dependsOn, section.name).toContain("contracts");
    }
  });

  test("no cycles in the dependency graph", () => {
    // If there were one, `withDependents` would not finish or would return too many.
    for (const section of SECTIONS) {
      const reach = withDependents([section]).map((s) => s.name);
      expect(reach).toContain(section.name);
      expect(new Set(reach).size).toBe(reach.length);
    }
  });
});

describe("bestSectionFor — the most specific prefix wins", () => {
  test.each([
    ["packages/core/domain/collection-builder.service.ts", "core"],
    ["packages/core/helpers/uri.helper.ts", "core"],
    ["packages/core/contracts/postman.interface.ts", "core"],
    // Scanners and parsers for each framework live outside the core
    // since the two layers were split.
    ["packages/frameworks/scanners/gin.scanner.ts", "frameworks"],
    ["packages/frameworks/laravel/laravel.scanner.ts", "frameworks"],
    ["packages/frameworks/parsers/zod-schema.helper.ts", "frameworks"],
    ["packages/frameworks/framework.registry.ts", "frameworks"],
    // The adapter is from the core: it works on the generic contract
    // `ParsedRoute`, not on any concrete framework.
    ["packages/core/adapters/parsed-route-to-spec.adapter.ts", "core"],
    ["packages/cli/commands/generate.script.ts", "cli"],
    ["examples/example-express/src/index.js", "e2e"],
    ["packages/plugins/delendai_tanit/src/index.ts", "plugin"],
  ])("%s → %s", (file, expected) => {
    expect(bestSectionFor(file)?.name).toBe(expected);
  });

  test("a file outside any section does not fall into any", () => {
    expect(bestSectionFor("README.md")).toBeUndefined();
    expect(bestSectionFor("docs/INSTALL.md")).toBeUndefined();
  });
});

describe("sectionsForFiles", () => {
  test("a scanner alone activates frameworks", () => {
    expect(
      sectionsForFiles(["packages/frameworks/scanners/flask.scanner.ts"]).map((s) => s.name),
    ).toEqual(["frameworks"]);
  });

  test("several files activate several sections, without repeating", () => {
    const names = sectionsForFiles([
      "packages/frameworks/scanners/flask.scanner.ts",
      "packages/frameworks/scanners/gin.scanner.ts",
      "packages/cli/commands/push.script.ts",
    ]).map((s) => s.name);
    expect(names).toEqual(["frameworks", "cli"]);
  });

  test.each(GLOBAL_PATHS.map((path) => [path]))(
    "touching %s forces running everything",
    (globalPath) => {
      const file = globalPath.endsWith("/") ? `${globalPath}algo.ts` : globalPath;
      expect(sectionsForFiles([file]).length).toBe(SECTIONS.length);
    },
  );

  test("changing only documentation activates no section", () => {
    expect(sectionsForFiles(["README.md", "docs/POSTMAN.md"])).toEqual([]);
  });
});

describe("withDependents", () => {
  test("touching the core drags along all its consumers", () => {
    const names = withDependents([sectionByName("core")!]).map((s) => s.name);
    expect(names).toEqual(["core", "frameworks", "cli", "e2e", "plugin"]);
  });

  test("touching a scanner does not drag along the core", () => {
    const names = withDependents([sectionByName("frameworks")!]).map((s) => s.name);
    expect(names).not.toContain("core");
    expect(names).toContain("frameworks");
    expect(names).toContain("e2e");
  });

  test("the leaf of the graph drags nothing else", () => {
    expect(withDependents([sectionByName("e2e")!]).map((s) => s.name)).toEqual(["e2e"]);
  });

  test("the declared order is preserved, not the discovery order", () => {
    const names = withDependents([sectionByName("cli")!, sectionByName("core")!]).map(
      (s) => s.name,
    );
    expect(names).toEqual(SECTIONS.filter((s) => names.includes(s.name)).map((s) => s.name));
  });
});
