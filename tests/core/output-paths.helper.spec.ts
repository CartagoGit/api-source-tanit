/**
 * Output directory precedence in the stateless helper.
 *
 * These rules used to live inside `paths.service.outputDir(context?)`
 * (singleton retired in r00010 S2, 2026-09-03), mixed with the
 * singleton's cache and with `process.argv` / `process.env` read
 * directly. Here they are tested in isolation: with a fabricated
 * context, without touching the process.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";

import {
  describeDiscoveredPaths,
  outputCollectionPath,
  outputEnvironmentPath,
  resolveOutputDir,
} from "../../packages/core/discovery/output-paths.helper";
import type { IProjectContext } from "../../packages/contracts/interfaces/core/project-context.interface";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";

/** Pre-fabricated context to keep the spec free of `resolveProjectContext`. */
function makeContext(overrides: Partial<IProjectContext> = {}): IProjectContext {
  return {
    projectRoot: "/tmp/proyecto",
    packageRoot: "/tmp/paquete",
    projectBasename: "proyecto",
    outputDir: "/tmp/proyecto/export-to-postman",
    ...overrides,
  };
}

describe("resolveOutputDir — precedence", () => {
  test("--output-dir in argv wins over the context", () => {
    expect(
      resolveOutputDir(
        makeContext({ outputDir: "/tmp/contexto" }),
        ["--output-dir", "/tmp/cli-dir"],
      ),
    ).toBe("/tmp/cli-dir");
  });

  test("--output in argv returns the dirname of the file", () => {
    expect(
      resolveOutputDir(makeContext(), ["--output", "/tmp/con-archivo/x.json"]),
    ).toBe(sep === "/" ? "/tmp/con-archivo" : "\\tmp\\con-archivo");
  });

  test("env POSTMAN_OUTPUT_DIR wins when there is no flag", () => {
    expect(
      resolveOutputDir(
        makeContext({ outputDir: "/tmp/contexto" }),
        [],
        { POSTMAN_OUTPUT_DIR: "/tmp/env-dir" },
      ),
    ).toBe("/tmp/env-dir");
  });

  test("CLI wins over env", () => {
    expect(
      resolveOutputDir(
        makeContext({ outputDir: "/tmp/contexto" }),
        ["--output-dir", "/tmp/cli-dir"],
        { POSTMAN_OUTPUT_DIR: "/tmp/env-dir" },
      ),
    ).toBe("/tmp/cli-dir");
  });

  test("without flag or env, falls back to context.outputDir", () => {
    expect(resolveOutputDir(makeContext({ outputDir: "/tmp/contexto" }), [], {})).toBe(
      "/tmp/contexto",
    );
  });

  test("without context, flag, or env: throws with an actionable message", () => {
    expect(() => resolveOutputDir(undefined, [], {})).toThrow(
      /output-dir|POSTMAN_OUTPUT_DIR|project-root/,
    );
  });

  test("without context but with --output-dir in argv: works", () => {
    expect(resolveOutputDir(undefined, ["--output-dir", "/tmp/cli-dir"], {})).toBe(
      "/tmp/cli-dir",
    );
  });

  /**
   * `--output-dir --json` (with no value) must NOT be read as if the
   * value were `--json`. Without the `!value.startsWith("--")` check,
   * the next flag would be swallowed and the folder would literally
   * be named `--json` on disk.
   */
  test("--output-dir with no value does not swallow the next flag", () => {
    expect(resolveOutputDir(makeContext({ outputDir: "/tmp/fallback" }), ["--output-dir", "--json"], {})).toBe(
      "/tmp/fallback",
    );
  });

  test("--output with no value does not swallow the next flag", () => {
    expect(
      resolveOutputDir(
        makeContext({ outputDir: "/tmp/fallback" }),
        ["--output", "--json"],
        {},
      ),
    ).toBe("/tmp/fallback");
  });
});

describe("outputCollectionPath — path composition", () => {
  let work: string;
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "output-paths-helper-"));
  });
  afterEach(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  test("joins outputDir + basename + .json", async () => {
    const out = work;
    const path = await outputCollectionPath(makeContext({ outputDir: out }), "mi-api", [], {});
    expect(path).toBe(join(out, "mi-api.postman_collection.json"));
  });

  test("without projectName uses the projectBasename from the context", async () => {
    const out = work;
    const path = await outputCollectionPath(makeContext({ outputDir: out, projectBasename: "api" }), undefined, [], {});
    expect(path).toBe(join(out, "api.postman_collection.json"));
  });

  test("the default path lands in <projectRoot>/export-to-postman/", () => {
    // The context built by `resolveProjectContext` leaves
    // outputDir = `<root>/export-to-postman` when no `--output-dir`
    // is passed. We fabricate it here by hand to pin down the expected
    // behavior.
    const ctx: IProjectContext = {
      projectRoot: "/tmp/proyecto",
      packageRoot: "/tmp/paquete",
      projectBasename: "proyecto",
      outputDir: "/tmp/proyecto/" + OUTPUT_DIR_NAME,
    };
    expect(resolveOutputDir(ctx, [], {})).toBe("/tmp/proyecto/" + OUTPUT_DIR_NAME);
  });

  test("respects --output-dir over the context", async () => {
    const ctx = makeContext({ outputDir: "/tmp/contexto" });
    const argv = ["--output-dir", work];
    const path = await outputCollectionPath(ctx, "x", argv, {});
    expect(path).toBe(join(work, "x.postman_collection.json"));
  });
});

describe("outputEnvironmentPath — environment slug", () => {
  let work: string;
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "output-paths-helper-"));
  });
  afterEach(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  test("slugifies the environment name to kebab-case", async () => {
    const path = await outputEnvironmentPath(makeContext({ outputDir: work }), "Local");
    expect(path).toMatch(/local\.postman_environment\.json$/);
  });

  test("strips accents and other diacritics", async () => {
    const path = await outputEnvironmentPath(makeContext({ outputDir: work }), "Producción Local");
    expect(path).toMatch(/produccion-local\.postman_environment\.json$/);
  });

  test("replaces non-alphanumeric characters with dashes", async () => {
    const path = await outputEnvironmentPath(makeContext({ outputDir: work }), "Stage_2 (QA)!");
    expect(path).toMatch(/stage-2-qa\.postman_environment\.json$/);
  });

  test("uses the projectBasename from the context when no projectName is given", async () => {
    const path = await outputEnvironmentPath(
      makeContext({ outputDir: work, projectBasename: "my-app" }),
      "Dev",
    );
    expect(path).toMatch(/my-app\.dev\.postman_environment\.json$/);
  });

  test("does not duplicate the .postman_collection suffix when building the basename", async () => {
    const path = await outputEnvironmentPath(makeContext({ outputDir: work }), "Local");
    expect(path).not.toMatch(/\.postman_collection\.local\.postman_environment\.json$/);
  });
});

describe("describeDiscoveredPaths — the trace does not lie", () => {
  /**
   * Without projectName the trace says `<nombre-del-proyecto>`, it does
   * not invent the directory name. It is the same contract that
   * `describeDiscoveredPaths` already had in the singleton retired
   * from `paths.service` (r00010 S2, 2026-09-03); what changes is that
   * here it is honored by a stateless helper.
   */
  test("without a project name says it does not know it yet", () => {
    const traza = describeDiscoveredPaths(makeContext({ projectBasename: "carpeta-ajena" }), undefined, []);
    expect(traza).toContain("<nombre-del-proyecto>");
    expect(traza).not.toContain("carpeta-ajena.postman_collection");
  });

  test("with projectName announces exactly the file that will be written", () => {
    const traza = describeDiscoveredPaths(makeContext(), "mi-api", []);
    expect(traza).toContain("mi-api.postman_collection.json");
  });

  test("lists the resolved projectRoot and outputDir", () => {
    const traza = describeDiscoveredPaths(
      makeContext({
        projectRoot: "/tmp/mi-api",
        outputDir: "/tmp/salida",
      }),
      undefined,
      [],
    );
    expect(traza).toContain("/tmp/mi-api");
    expect(traza).toContain("/tmp/salida");
  });
});
