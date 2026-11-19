import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { CLI_ENTRYPOINT, fromRoot } from "../../scripts/helpers/root.helper.js";
import { copyExampleClean } from "../helpers/fixtures.js";
import { runProcess } from "../helpers/run-process.js";

test.each(["generate", "watch"])("%s uses the canonical project and destination variables", async (command) => {
  const temporary = await mkdtemp(join(tmpdir(), "tanit-canonical-env-"));
  const project = join(temporary, "project");
  const preferred = join(project, "preferred");
  const inherited = join(project, "inherited");
  try {
    await copyExampleClean(fromRoot("tests", "smoke-fixtures", "express-mini"), project);
    const args = [CLI_ENTRYPOINT, command];
    if (command === "watch") args.push("--once");
    const result = await runProcess("bun", args, {
      cwd: temporary,
      env: {
        TANIT_PROJECT_ROOT: project,
        TANIT_OUTPUT_DIR: preferred,
        POSTMAN_PROJECT_ROOT: join(temporary, "missing-legacy-project"),
        POSTMAN_OUTPUT_DIR: inherited,
        TANIT_CONFIG: undefined,
        POSTMAN_CONFIG: undefined,
        XDG_DATA_HOME: join(temporary, "data"),
      },
    });
    expect(result.code, result.output).toBe(0);
    const collection = (await readdir(preferred)).find(file => file.endsWith(".postman_collection.json"));
    expect(collection).toBeDefined();
    const document = JSON.parse(await readFile(join(preferred, collection!), "utf8")) as { item: unknown[] };
    expect(document.item.length).toBeGreaterThan(0);
    await expect(readdir(inherited)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 30_000);
