/**
 * The path to the CLI the plugin spawns.
 *
 * This spec exists because the plugin and the CLI **do not share
 * types**: the only thing tying them together is a string holding a
 * path, and nobody checks that string. When we reorganised into
 * `packages/` the CLI moved and this string was left behind in three
 * places; the tools kept registering, the tests stayed green, and
 * `generate` only failed when actually run against the host.
 *
 * This is where we check what no typecheck can: that the file at the
 * end of the path actually exists.
 */
import { describe, expect, test } from "vitest";
import { existsSync, statSync } from "node:fs";

import {
  CLI_SCRIPT_RELATIVE,
  resolveCliScript,
} from "../../src/lib/contracts/cli-path.constant";
import { workspaceRoot } from "../helpers/plugin-context";

const ROOT = workspaceRoot(import.meta.url);

describe("resolveCliScript", () => {
  // The test that matters: if anyone moves the CLI, this fails by
  // naming the exact constant instead of breaking the tool for whoever
  // uses it.
  test("la ruta por defecto apunta a un fichero que existe", () => {
    const resolved = resolveCliScript(ROOT);
    expect(existsSync(resolved), resolved).toBe(true);
    expect(statSync(resolved).isFile()).toBe(true);
  });

  test("el override de `cliScript` gana", () => {
    expect(resolveCliScript(ROOT, "/otro/sitio/cli.ts")).toBe("/otro/sitio/cli.ts");
  });

  test("un override vacío no cuenta como override", () => {
    expect(resolveCliScript(ROOT, "")).toBe(resolveCliScript(ROOT));
  });

  test("es relativa, para poder componerla con cualquier workspace", () => {
    expect(CLI_SCRIPT_RELATIVE.startsWith("/")).toBe(false);
    expect(CLI_SCRIPT_RELATIVE.includes("\\")).toBe(false);
  });
});

describe("delendai.config.json", () => {
  /**
   * The host reads its `cliScript` from the config, not from the
   * constant. They are two copies of the same path, so the one that
   * runs in production can go stale even when the constant is fine —
   * which is exactly what happened.
   */
  test("el `cliScript` configurado coincide con la constante", async () => {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(`${ROOT}/delendai.config.json`, "utf8");
    const config = JSON.parse(raw) as {
      plugins?: Record<string, { options?: Record<string, unknown> }>;
    };
    const configured = config.plugins?.["tanit"]?.options?.["cliScript"];
    expect(typeof configured).toBe("string");
    expect(configured).toBe(`\${workspaceFolder}/${CLI_SCRIPT_RELATIVE}`);
  });
});
