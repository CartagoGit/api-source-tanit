import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { EXPORT_FORMATS } from "../../packages/contracts/constants/core/export-formats.constant.js";
import type { ExportOutput } from "../../packages/contracts/interfaces/core/application-api.interface.js";
import type { PostmanCollection } from "../../packages/contracts/interfaces/core/postman.interface.js";
import { runGenerate } from "../../packages/cli/commands/generate.script.js";
import { dispatch } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { closeAllSessions } from "../../packages/core/session/project-session.service.js";
import { walkCollection } from "../../packages/core/helpers/postman.helper.js";
import { defaultOrchestrator } from "../../packages/frameworks/index.js";
import { exampleDir } from "../../scripts/helpers/root.helper.js";
import { copyExampleClean } from "../helpers/fixtures.js";

const injection = vi.hoisted(() => ({ failOpenApi: false }));
vi.mock("../../packages/core/exporters/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/core/exporters/registry.js")>();
  return {
    ...actual,
    selectExporters: (formats: Parameters<typeof actual.selectExporters>[0]) => actual.selectExporters(formats).map((exporter) =>
      injection.failOpenApi && exporter.id === "openapi"
        ? { ...exporter, build: async () => { throw new Error("Injected exporter failure"); } }
        : exporter,
    ),
  };
});

describe("CLI and Application API share prepared artifacts", () => {
  let work: string;

  beforeEach(async () => {
    injection.failOpenApi = false;
    work = await mkdtemp(join(tmpdir(), "tanit-export-parity-"));
  });
  afterEach(async () => {
    injection.failOpenApi = false;
    closeAllSessions();
    await rm(work, { recursive: true, force: true });
  });

  test.each(["express", "laravel"])("%s produces byte-identical files for every format", async (framework) => {
    const root = join(work, "project");
    const cliDirectory = join(work, "cli");
    const apiDirectory = join(work, "api");
    await copyExampleClean(exampleDir(framework), root);
    if (framework === "laravel") {
      // Exercise genuinely different examples, not a duplicate of the base body.
      const request = join(root, "app/Http/Requests/UpdateAddressRequest.php");
      const rules = await readFile(request, "utf8");
      await writeFile(request, rules.replace("required|string|size:2", "required|in:ES,FR,US"));
    }
    const generated = await runGenerate([
      "--project-root", root, "--output-dir", cliDirectory,
      "--formats", EXPORT_FORMATS.join(","), "--envs", "local",
    ]);
    expect(generated.code).toBe(0);
    expect(generated.report).not.toBeNull();
    if (generated.report === null) return;
    const cliFiles = [generated.report.collectionPath!, ...generated.report.extraPaths];
    const context = { caller: "browser" as const, orchestrator: defaultOrchestrator() };
    const registry = buildRegistry();
    expect((await dispatch(registry, "open-project", { projectRoot: root }, context)).ok).toBe(true);
    const apiFiles: string[] = [];
    for (const target of EXPORT_FORMATS) {
      const answer = await dispatch<ExportOutput>(registry, "export", {
        projectRoot: root, target, outputDirectory: apiDirectory,
      }, context);
      expect(answer.ok, target).toBe(true);
      if (!answer.ok) continue;
      apiFiles.push(...answer.value.files);
    }
    expect(apiFiles.map((path) => relative(apiDirectory, path)).sort())
      .toEqual(cliFiles.map((path) => relative(cliDirectory, path)).sort());
    for (const cliFile of cliFiles) {
      const name = relative(cliDirectory, cliFile);
      expect(await readFile(join(apiDirectory, name), "utf8"), name).toBe(await readFile(cliFile, "utf8"));
    }
    expect(generated.report.environmentPaths.length).toBeGreaterThan(0);
    for (const path of generated.report.environmentPaths) {
      expect(JSON.parse(await readFile(path, "utf8"))).toHaveProperty("values");
    }
    if (framework === "laravel") {
      const collection = JSON.parse(await readFile(generated.report.collectionPath!, "utf8")) as PostmanCollection;
      expect(walkCollection(collection).some((route) => route.name.startsWith("Variant:"))).toBe(true);
    }
  });

  test("a later exporter failure leaves an existing collection untouched and writes no other format", async () => {
    const root = join(work, "project");
    const output = join(work, "existing.json");
    const extraDirectory = join(work, "extra");
    await copyExampleClean(exampleDir("express"), root);
    await writeFile(output, "previous collection\n");
    injection.failOpenApi = true;
    const generated = await runGenerate([
      "--project-root", root, "--output", output,
      "--output-dir", extraDirectory, "--formats", "postman,openapi,bruno",
    ]);
    expect(generated.code).toBe(1);
    expect(await readFile(output, "utf8")).toBe("previous collection\n");
    expect(existsSync(extraDirectory)).toBe(false);
  });
});
