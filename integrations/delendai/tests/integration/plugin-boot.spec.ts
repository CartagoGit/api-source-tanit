/**
 * Plugin boot (p00013).
 *
 * The plugin is loaded by its `path` from `delendai.config.json`, so
 * a failure here is not visible until the MCP host tries to start
 * and crashes entirely. These tests instantiate it the same way the
 * host would.
 */
import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import plugin from "../../src/index";
import { makeContext, registeredTools, workspaceRoot } from "../helpers/plugin-context";

const PACKAGE_ROOT = workspaceRoot(import.meta.url);

/**
 * The roots the host accepts for a tool that writes.
 *
 * Written here instead of imported from the core on purpose: the
 * core's type is a closed union, and a test that used it would pass
 * whatever the core accepts today — including a root this plugin
 * has no business using. The list below is the contract *this*
 * plugin keeps.
 */
const WRITE_ROOTS: readonly string[] = [
  "caller-checkout",
  "repository",
  "host-state",
  "server",
  "remote",
];

const makeCtx = (options: Record<string, unknown> = {}) =>
  makeContext({ workspaceRoot: PACKAGE_ROOT, options });

/** The 4 tools the plugin promises, by id. */
const EXPECTED_TOOLS = [
  "check",
  "generate",
  "init",
  "list",
  "push",
  "scan",
  "stats",
  "summary",
  "test",
  "validate",
] as const;

describe("arranque del plugin", () => {
  test("declara nombre y versión", () => {
    expect(plugin.name).toBe("tanit");
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test(`registra exactamente los ${EXPECTED_TOOLS.length} tools`, async () => {
    const tools = await registeredTools(plugin, makeCtx());
    expect(tools.map((tool) => tool.id).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  test("cada tool trae su función register", async () => {
    for (const tool of await registeredTools(plugin, makeCtx())) {
      expect(typeof tool.register).toBe("function");
    }
  });

  // The declared effects are what the host uses to decide whether
  // an agent can invoke the tool without confirmation.
  test("tools that write or spawn processes declare it", async () => {
    const tools = await registeredTools(plugin, makeCtx());
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    expect(byId.get("generate")?.effects).toContain("write");
    expect(byId.get("test")?.effects).toContain("spawn");
    // `summary` only inspects: it must not declare effects.
    expect(byId.get("summary")?.effects ?? []).toEqual([]);
  });

  /**
   * A tool that writes and says no root does not boot.
   *
   * The host refuses to plan a registration sequence with a `write`
   * effect and no `writeRoot`, and the server MCP dies while
   * starting: the editor shows "the server stopped while handling
   * this request" and every tool disappears, with the reason buried
   * in the server's stderr. This test is the same rule, one layer
   * earlier, where it can still be read.
   */
  test("todo tool que escribe declara dónde escriben sus escrituras", async () => {
    const tools = await registeredTools(plugin, makeCtx());
    for (const tool of tools) {
      if (!(tool.effects ?? []).includes("write")) continue;
      expect(
        tool.writeRoot,
        `${tool.id} declara el efecto "write" y no declara writeRoot`,
      ).toBeDefined();
      expect(WRITE_ROOTS).toContain(tool.writeRoot);
    }
  });

  /**
   * And each one says the root that is true of it, not a root that
   * merely satisfies the host.
   *
   * `generate` and `init` write into the project they document,
   * which is the server's own root: the plugin resolves its paths
   * from its options and the call's arguments, and the runner
   * spawns in the server's root, so the writes do not follow the
   * caller's checkout. `push` writes nothing here: the collection
   * lands in the Postman workspace.
   */
  test("cada tool que escribe declara la raíz que le corresponde", async () => {
    const tools = await registeredTools(plugin, makeCtx());
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    expect(byId.get("generate")?.writeRoot).toBe("server");
    expect(byId.get("init")?.writeRoot).toBe("server");
    expect(byId.get("push")?.writeRoot).toBe("remote");
  });

  test("registrar dos veces no acumula estado", async () => {
    const first = (await registeredTools(plugin, makeCtx())).map((tool) => tool.id);
    const second = (await registeredTools(plugin, makeCtx())).map((tool) => tool.id);
    expect(second).toEqual(first);
  });

  test("arranca con options vacías", () => {
    expect(() => plugin.register(makeCtx({}))).not.toThrow();
  });

  test("arranca con las options declaradas en la config", async () => {
    const ctx = makeCtx({
      defaultProjectRoot: "/tmp/proyecto",
      cliScript: "/tmp/cli.ts",
    });
    // The figure comes from `EXPECTED_TOOLS`, not written by hand:
    // the literal `6` here went stale when `stats` and `scan` were
    // added, same as the plugin docblock's tools list said three
    // when there were already six.
    expect(await registeredTools(plugin, ctx)).toHaveLength(EXPECTED_TOOLS.length);
  });

  test("declara un optionsSchema", () => {
    expect(plugin.optionsSchema).toBeDefined();
  });
});

describe("declaración en delendai.config.json", () => {
  test("el path del plugin apunta a un fichero que existe", async () => {
    const config = JSON.parse(
      await readFile(resolve(PACKAGE_ROOT, "delendai.config.json"), "utf8"),
    ) as { plugins?: Record<string, { path?: string }> };

    const declared = config.plugins?.["tanit"]?.path;
    expect(declared).toBeDefined();

    const entry = await import(resolve(PACKAGE_ROOT, declared!));
    expect(entry.default?.name).toBe("tanit");
  });

  // Superseded plugins are removed from the config so the host does
  // not crash on boot with an entry pointing at a deleted directory.
  // Today the canonical plugin list lives in `delendai.config.json`;
  // this test counts them so a forgotten plugin shows up as a red
  // test instead of a dead host at boot.
  test("cuenta los plugins declarados en delendai.config.json", async () => {
    const config = JSON.parse(
      await readFile(resolve(PACKAGE_ROOT, "delendai.config.json"), "utf8"),
    ) as { plugins?: Record<string, unknown> };

    expect(Object.keys(config.plugins ?? {})).toContain("tanit");
  });
});
