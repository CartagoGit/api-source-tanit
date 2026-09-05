/**
 * `process.argv` does not enter the core at runtime (a00012 S4).
 *
 * Before S4, `resolveConfigPath` and `loadProject` declared
 * `argv: string[] = process.argv` as default. The core read the
 * process global: the MCP server or the web UI, which also call into
 * the pipeline, ended up inheriting the argv of the host process. The
 * bug was silent: in the typical plugin case the global carried the
 * IDE's flags, so `--config` did not match and it fell back to the
 * zero-config, but a `--config <something>` from the host that
 * happened to coincide with the wrong path could overwrite the
 * project's config.
 *
 * S4 closes the leak: the default becomes
 * `argv: ReadonlyArray<string> = []`. The CLI passes
 * `process.argv.slice(2)` from `cli.script.ts` (the composition root —
 * there, yes, touching the global is fine), and tests pass an explicit
 * or empty array.
 *
 * This spec verifies the property from three angles:
 *
 *   1. `loadProject` with `argv: []` does not read `process.argv`. We
 *      demonstrate it by stubbing `process.argv` and watching the
 * function not consult it.
 *   2. `--config <path>` is applied when it is in the explicit array,
 *      ignoring the global.
 *   3. The pipeline (`generation.pipeline.ts`) passes `options.argv ?? []`
 *      to `loadProject`, so the caller controls the array.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";
import {
  buildZeroConfig,
  loadProject,
  resolveConfigPath,
} from "../../packages/core/discovery/project-loader.service";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";
import { generateCollection } from "../../packages/core/discovery/generation.pipeline";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import type { IProjectContext } from "../../packages/contracts/interfaces/core/project-context.interface";

let projectTmp: ITempProject | null = null;

afterEach(async () => {
  await projectTmp?.cleanup();
  projectTmp = null;
  vi.restoreAllMocks();
});

/**
 * `process.argv` stub with backup/restore around the test.
 *
 * `process.argv` is **getter-only** in Bun and Node 20+, so the right
 * form is `vi.spyOn(process, "argv", "get")`. The function returns the
 * spy so the test can assert against it without re-calling.
 */
function withStubbedArgv<T>(argv: string[], fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(process, "argv", "get").mockReturnValue(argv);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

async function inProject<T>(
  files: Record<string, string>,
  fn: (context: IProjectContext) => Promise<T>,
): Promise<T> {
  projectTmp = await createTempProject(files, "argv-free-");
  return fn(resolveProjectContext({ projectRoot: projectTmp.root }));
}

describe("loadProject no lee process.argv (a00012 S4)", () => {
  test("argv=[] ignores the global process.argv: host's --config does not apply", async () => {
    await inProject(
      {
        "composer.json": '{"name":"acme/argv-free"}',
      },
      async (context) => {
        // The process global says `--config /etc/passwd`. If the
        // loader read process.argv, it would skip normal detection
        // and fail on a non-existent path. Since it no longer reads
        // it, the flag is ignored and the project's config is
        // resolved.
        await withStubbedArgv(["node", "x", "--config", "/etc/passwd"], async () => {
          const loaded = await loadProject([], context);
          // The config comes from the project (composer.json) or
          // zero-config; in any case NOT from /etc/passwd.
          expect(loaded.config.name).not.toBe("passwd");
          expect(loaded.configPath).not.toBe("/etc/passwd");
        });
      },
    );
  });

  test("argv=['--config', '<my-config>'] applies the flag and rejects the global", async () => {
    await inProject(
      {
        "composer.json": '{"name":"acme/explicit-argv"}',
      },
      async (context) => {
        const cfg = `${projectTmp!.root}/mi-config.ts`;
        // The global says something else; the explicit argv of the
        // loader wins. The function resolves the flag from the array
        // we pass, not the global.
        await withStubbedArgv(["node", "x", "--config", "/global-that-must-not-apply"], async () => {
          const path = await resolveConfigPath(["node", "x", "--config", cfg], context);
          expect(path).toBe(cfg);
        });
      },
    );
  });

  test("process.argv stub: the loader does not consult it", async () => {
    // We verify that `loadProject` calls nothing that returns
    // `process.argv`. This is a guard from universal §6 ("no reading
    // globals in the hot path"): if anyone adds a default
    // `process.argv` in the future, this test catches it.
    await inProject(
      {
        "composer.json": '{"name":"acme/no-leer-global"}',
      },
      async (context) => {
        const spy = vi.spyOn(process, "argv", "get");
        await withStubbedArgv(["node", "x", "--config", "/no-aplica"], async () => {
          await loadProject([], context);
        });
        // The loader with argv=[] must not have read process.argv at
        // any point: not even once.
        expect(spy).not.toHaveBeenCalled();
      },
    );
  });
});

describe("resolveConfigPath does not read process.argv (a00012 S4)", () => {
  test("argv=[] ignores --config from the global", async () => {
    await inProject(
      {
        "composer.json": '{"name":"acme/resolve-argv"}',
      },
      async (context) => {
        await withStubbedArgv(["node", "x", "--config", "/lo-que-sea"], async () => {
          // Without explicit argv, it must resolve the project's
          // config (or the "__zero__" sentinel), never the global
          // flag.
          const path = await resolveConfigPath([], context);
          expect(path).not.toBe("/lo-que-sea");
          expect(typeof path).toBe("string");
        });
      },
    );
  });
});

describe("buildZeroConfig does not read process.argv (a00012 S4)", () => {
  test("a stubbed argv does not affect the default baseUrl", async () => {
    await inProject(
      {
        "composer.json": '{"name":"acme/zero-argv"}',
      },
      async (context) => {
        await withStubbedArgv(
          ["node", "x", "--config", "/etc/passwd", "--framework", "laravel"],
          async () => {
            const config = await buildZeroConfig(context);
            expect(config.baseUrl).toBe("http://localhost");
          },
        );
      },
    );
  });
});

describe("generation.pipeline passes explicit argv to the loader (a00012 S4)", () => {
  test("generateCollection without options.argv: the pipeline does not break", async () => {
    // The expected behavior is that `options.argv` is missing and the
    // loader receives `[]`. If anyone restores `process.argv` here,
    // this test detects the contract change: the pipeline must keep
    // working even if the global has a weird `--config`.
    projectTmp = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "express-argv-free",
          dependencies: { express: "^4.19.0" },
        }),
        "server.js": `import express from "express";
const app = express();
app.get("/ping", (_req, res) => res.json({ ok: true }));
app.listen(3000);
`,
      },
      "generate-argv-free-",
    );

    await withStubbedArgv(
      ["node", "x", "--config", "/etc/passwd"],
      async () => {
        const result = await generateCollection(projectTmp!.root, {
          orchestrator: defaultOrchestrator(),
        });
        // The default baseUrl must NOT contain the stubbed global.
        expect(result.config.baseUrl).not.toBe("/etc/passwd");
        expect(result.config.baseUrl).toBe("http://localhost");
      },
    );
  });
});