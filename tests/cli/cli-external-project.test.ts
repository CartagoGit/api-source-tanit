/**
 * The CLI run against a project EXTERNAL to the package.
 *
 * It is the main use case —someone installs the package and runs it
 * against their API— and it was the only one without coverage. It was
 * broken: the CLI spawned the generation script with `cwd` = package
 * root, and the pipeline resolved the project root as `process.env.
 * POSTMAN_PROJECT_ROOT ?? "."`, so `--project-root` was ignored and the
 * scan targeted export-to-postman itself: empty collection.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../helpers/run-process";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { CLI_ENTRYPOINT, REPO_ROOT, exampleDir } from "../../scripts/helpers/root.helper";

const CLI = CLI_ENTRYPOINT;
const SOURCE_PROJECT = exampleDir("express");

let externalProject = "";

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "postman-cli-external-"));
  externalProject = join(dir, "mi-api");
  await cp(SOURCE_PROJECT, externalProject, { recursive: true });
});

afterAll(async () => {
  if (externalProject) {
    await rm(resolve(externalProject, ".."), { recursive: true, force: true });
  }
});

async function runCli(args: string[]): Promise<{ code: number; output: string }> {
  return runProcess("bun", [CLI, ...args], { cwd: REPO_ROOT });
}

async function readCollection(): Promise<Record<string, unknown>> {
  const buildDir = join(externalProject, OUTPUT_DIR_NAME);
  const files = await readdir(buildDir);
  const name = files.find((f) => f.endsWith(".postman_collection.json"));
  expect(name).toBeDefined();
  return JSON.parse(await readFile(join(buildDir, name!), "utf8")) as Record<string, unknown>;
}

function countRequests(items: ReadonlyArray<Record<string, any>>): number {
  return items.reduce(
    (total, item) => total + (item["item"] ? countRequests(item["item"]) : 1),
    0,
  );
}

describe("CLI against an external project", () => {
  test("`generate --project-root` scans the given project, not the package", async () => {
    const { code } = await runCli(["generate", "--project-root", externalProject]);
    expect(code).toBe(0);

    const collection = await readCollection();
    const requests = countRequests((collection["item"] as Record<string, any>[]) ?? []);
    // The express fixture exposes 9 endpoints. Before it returned 0.
    expect(requests).toBe(9);
  });

  test("detects the framework of the external project", async () => {
    const { output } = await runCli(["generate", "--project-root", externalProject]);
    expect(output).toContain("framework=express");
  });

  test("writes the collection inside the project, not the package", async () => {
    await runCli(["generate", "--project-root", externalProject]);
    const files = await readdir(join(externalProject, OUTPUT_DIR_NAME));
    expect(files.some((f) => f.endsWith(".postman_collection.json"))).toBe(true);
  });

  test("also generates the environments", async () => {
    await runCli(["generate", "--project-root", externalProject]);
    const files = await readdir(join(externalProject, OUTPUT_DIR_NAME));
    expect(files.filter((f) => f.endsWith(".postman_environment.json")).length).toBeGreaterThan(
      0,
    );
  });

  test("the resulting collection is Postman v2.1.0 with stable id", async () => {
    await runCli(["generate", "--project-root", externalProject]);
    const first = (await readCollection())["info"] as Record<string, string>;
    await runCli(["generate", "--project-root", externalProject]);
    const second = (await readCollection())["info"] as Record<string, string>;

    expect(first["schema"]).toContain("2.1.0");
    expect(first["_postman_id"]).toBe(second["_postman_id"]!);
  });

  test("`--help` documents the available commands", async () => {
    const { output } = await runCli(["--help"]);
    for (const command of ["generate", "check", "list", "stats", "validate"]) {
      expect(output).toContain(command);
    }
  });
});
