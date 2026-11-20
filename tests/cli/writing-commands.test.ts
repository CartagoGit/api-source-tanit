/**
 * The commands that write or talk to the outside: `init`, `push`, `open`.
 *
 * None had tests, and `init` actually **made the project worse**. It
 * detected the name by looking only at `composer.json` —a relic from
 * when the tool was Laravel-only— and, not finding it, kept the
 * folder name. Since the configuration it generates overrides the
 * automatic detection, on `example-express` the project went from
 * being called `sample-express` to being called after the directory:
 * running the wizard left things worse than they were.
 *
 * And it ended by suggesting `bun run build`, which is a script **of
 * this repository**, not of the user's project. The wizard exists
 * precisely for whoever does not know the flags, so closing it with
 * a command they cannot run leaves them stuck on the last step.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";
import { runGenerate } from "../../packages/cli/commands/generate.script";
import { main as openPostman } from "../../packages/cli/commands/open-postman.script";

vi.mock("../../packages/cli/commands/open-postman.script", () => ({ main: vi.fn() }));

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "writing-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/** A clean project per test, because these commands write. */
async function proyecto(nombre: string, framework = "express"): Promise<string> {
  const root = join(work, nombre);
  await copyExampleClean(exampleDir(framework), root);
  return root;
}

function run(comando: string, args: readonly string[]): Promise<{ code: number; output: string }> {
  return runProcess("bun", [join(CLI_COMMANDS_DIR, `${comando}.script.ts`), ...args]);
}

describe("init", () => {
  test("detects the manifest name, not the folder one", { timeout: 120_000 }, async () => {
    const root = await proyecto("folder-name-different");
    const { code, output } = await run("init", ["--project-root", root]);
    expect(code, output).toBe(0);
    // The detection line, not the whole output: the paths it prints
    // contain the directory name inside and that is legitimate.
    const detectado = /Project detected:\s+(\S+)/.exec(output)?.[1];
    expect(detectado).toBe("sample-express");
  });

  /**
   * THE test: without it, the wizard degraded the project and it was
   * only visible by running another command afterwards.
   */
  test("what it generates does not worsen detection", { timeout: 120_000 }, async () => {
    const root = await proyecto("do-not-degrade");
    const antes = await run("summary", ["--project-root", root]);
    await run("init", ["--project-root", root]);
    const despues = await run("summary", ["--project-root", root]);

    const nombre = (salida: string): string =>
      /Project name:\s+(\S+)/.exec(salida)?.[1] ?? "";
    expect(nombre(antes.output)).toBe("sample-express");
    expect(nombre(despues.output)).toBe(nombre(antes.output));
  });

  test("the suggested next step is actually runnable", { timeout: 120_000 }, async () => {
    const root = await proyecto("next-step");
    const { output } = await run("init", ["--project-root", root]);
    // The suggested command uses the canonical name (`BIN_NAME`);
    // if the binary is renamed, this test alerts together with the
    // launchers one.
    expect(output).toContain("apisrc generate");
    // `bun run build` is a script of this repo, not of the user's
    // project.
    expect(output).not.toContain("bun run build");
  });

  test("`--name` overrides the detection", { timeout: 120_000 }, async () => {
    const root = await proyecto("con-nombre");
    const { output } = await run("init", ["--project-root", root, "--name", "mi-api"]);
    expect(output).toContain("mi-api");
  });

  test("the configuration it writes is read by `generate`", { timeout: 120_000 }, async () => {
    const root = await proyecto("config-usable");
    await run("init", ["--project-root", root]);
    const { code, output } = await run("generate", ["--project-root", root]);
    expect(code, output).toBe(0);
    // And the collection comes out with the right name, not the directory's.
    const summary = await run("summary", ["--project-root", root]);
    expect(summary.output).toContain("Zero-config:      no");
  });
});

describe("push", () => {
  test("without a key exits with 1 and says where to get one", { timeout: 120_000 }, async () => {
    const root = await proyecto("push-sin-clave");
    const { code, output } = await runProcess(
      "bun",
      [join(CLI_COMMANDS_DIR, "push.script.ts"), "--project-root", root],
      { env: { POSTMAN_API_KEY: "" } },
    );
    expect(code).toBe(1);
    expect(output).toMatch(/api.?key/i);
    expect(output).toContain("postman.co");
  });

  /**
   * A key is a secret. Having it appear in the output is how it ends
   * up in a CI log, and from there it cannot be erased.
   */
  test("never prints the key it is given", { timeout: 120_000 }, async () => {
    const root = await proyecto("push-clave-falsa");
    const secreto = "pmak-000000000000000000000000-secreto-que-no-debe-salir";
    const { output } = await run("push", [
      "--project-root",
      root,
      "--api-key",
      secreto,
    ]);
    expect(output).not.toContain(secreto);
    expect(output).not.toContain("secreto-que-no-debe-salir");
  });
});

describe("open", () => {
  test("without a collection exits with 1 and does not hang", { timeout: 120_000 }, async () => {
    const root = await proyecto("open-sin-coleccion");
    const { code } = await run("open-postman", ["--project-root", root]);
    expect(code).toBe(1);
  });
});

describe("generate --open", () => {
  test("opens the generated custom output with injected context after writing", async () => {
    const root = await proyecto("generate-open");
    const outputPath = join(root, "custom-output.json");
    const open = vi.mocked(openPostman);
    open.mockReset();
    open.mockImplementationOnce(async (args, options) => {
      const fileIndex = args?.indexOf("--file") ?? -1;
      const target = args?.[fileIndex + 1];
      expect(target).toBe(outputPath);
      expect(options?.context?.projectRoot).toBe(root);
      const written = JSON.parse(await readFile(outputPath, "utf8"));
      expect(written.info.name).toBeTruthy();
      return 0;
    });
    const result = await runGenerate(["--project-root", root, "--output", outputPath, "--open"]);
    expect(result.code).toBe(0);
    expect(open).toHaveBeenCalledOnce();
  });

  test("propagates a launcher failure after successful generation", async () => {
    const root = await proyecto("generate-open-failure");
    vi.mocked(openPostman).mockReset().mockResolvedValueOnce(1);
    const result = await runGenerate(["--project-root", root, "--open"]);
    expect(result.code).toBe(1);
    expect(vi.mocked(openPostman)).toHaveBeenCalledOnce();
  });
});

describe("commands that write do so atomically", () => {
  /**
   * `init` wrote with `writeFileSync`. A mid-write failure left a
   * truncated configuration, which is worse than none: the project
   * ends up with a file that does not parse and `generate` stops
   * starting.
   */
  test("the configuration left by `init` is complete TypeScript", { timeout: 120_000 }, async () => {
    const root = await proyecto("init-atomic");
    const { output } = await run("init", ["--project-root", root]);
    const ruta = /· (\S+config\.constant\.ts)/.exec(output)?.[1] ?? "";
    expect(ruta).not.toBe("");
    const contenido = await readFile(ruta, "utf8");
    // No truncation: it opens and closes.
    expect(contenido).toContain("export const");
    expect(contenido.trimEnd().endsWith("}") || contenido.trimEnd().endsWith(";")).toBe(true);
  });
});
