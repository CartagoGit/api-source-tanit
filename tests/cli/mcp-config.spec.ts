/**
 * That the MCP server configuration talks about the repo that exists.
 *
 * `plugins.search.options.roots` and `plugins.conventions.options.roots`
 * declared `contract`, `service`, `helper`, and `plugins`: the
 * structure before everything moved under `packages/`. The server
 * itself flagged it in `overview.configIssues` with eight issues —
 * *"does not exist in this workspace — the plugin will scan nothing"*.
 *
 * The failure is of the bad kind: the two plugins kept **returning
 * results**, only from a fraction of the repo. A search that does not
 * find something cannot be told apart from a search over a folder that
 * does not exist, so the automated audit looked complete while being
 * born biased.
 *
 * This checks against the disk, which is the only way that moving a
 * folder breaks here and not silently.
 */
import { describe, expect, test } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper";

interface IPluginOptions {
  readonly roots?: ReadonlyArray<string>;
}

interface IMcpConfig {
  readonly plugins?: Readonly<Record<string, { readonly options?: IPluginOptions }>>;
}

async function config(): Promise<IMcpConfig> {
  return JSON.parse(
    await readFile(join(REPO_ROOT, "delendai.config.json"), "utf8"),
  ) as IMcpConfig;
}

async function esDirectorio(rel: string): Promise<boolean> {
  try {
    return (await stat(join(REPO_ROOT, rel))).isDirectory();
  } catch {
    return false;
  }
}

/** The plugins that declare which folders they work on. */
const CON_ROOTS = ["search", "conventions"] as const;

describe("the roots scanned by the plugins", () => {
  test.for(CON_ROOTS)("%s declares them", async (plugin) => {
    const roots = (await config()).plugins?.[plugin]?.options?.roots;
    expect(roots, `${plugin} no declara roots`).toBeDefined();
    expect(roots?.length ?? 0).toBeGreaterThan(0);
  });

  // THE test: without it, the server warns and nobody reads it.
  test.for(CON_ROOTS)("all of %s roots exist on disk", async (plugin) => {
    const roots = (await config()).plugins?.[plugin]?.options?.roots ?? [];
    const fantasmas: string[] = [];
    for (const root of roots) {
      if (!(await esDirectorio(root))) fantasmas.push(root);
    }
    expect(
      fantasmas,
      `${plugin} escanea carpetas que no existen: ${fantasmas.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The symmetric failure: declaring so little that the plugin does
   * not see the code. `packages/` is where everything that gets
   * published lives; if it is missing, search and conventions look
   * at anything but the product.
   */
  test.for(CON_ROOTS)("%s covers the code that is published", async (plugin) => {
    const roots = (await config()).plugins?.[plugin]?.options?.roots ?? [];
    expect(roots).toContain("packages");
  });
});

/**
 * The loose directories declared in the configuration.
 *
 * `roots` was already checked; this covers the rest —`scaffoldDir`,
 * `auditDir`, `proposalsDir`…—, which is where the failure slipped
 * in: `issues.scaffoldDir` pointed to
 * `docs/delendai/proposals/retired/issues`, inside the proposals
 * tree, where `lint:proposals` requires
 * `<kind><NNNNN>-<slug>.md`. The first issue written there would
 * have broken the repo gate.
 */
describe("the directories declared in the configuration", () => {
  test("all exist on disk", async () => {
    const c = await config();
    const fantasmas: string[] = [];

    for (const [nombre, plugin] of Object.entries(c.plugins ?? {})) {
      const options = (plugin as { options?: Record<string, unknown> }).options ?? {};
      for (const [clave, valor] of Object.entries(options)) {
        if (!/Dir$/.test(clave) || typeof valor !== "string") continue;
        if (!(await esDirectorio(valor))) fantasmas.push(`${nombre}.${clave} → ${valor}`);
      }
    }

    expect(fantasmas, `declared directories that do not exist`).toEqual([]);
  });

  /**
   * And none may point inside the proposals tree: `lint:proposals`
   * rules there, requiring a name with id and kind. A plugin that
   * writes there breaks the gate on the first try.
   */
  test("none writes inside the proposals tree", async () => {
    const c = await config();
    const invasores: string[] = [];

    for (const [nombre, plugin] of Object.entries(c.plugins ?? {})) {
      const options = (plugin as { options?: Record<string, unknown> }).options ?? {};
      for (const [clave, valor] of Object.entries(options)) {
        if (clave === "auditDir" || !/Dir$/.test(clave)) continue;
        if (typeof valor !== "string") continue;
        if (valor.includes("proposals/")) invasores.push(`${nombre}.${clave} → ${valor}`);
      }
    }

    expect(invasores).toEqual([]);
  });
});

describe("the own plugin is declared with a path that exists", () => {
  /**
   * A `path` that does not resolve leaves the plugin out silently:
   * the server starts the same, with one fewer tool. Every
   * `"path": "…"` in the file is checked, not only expostman's, so
   * that adding a new plugin with a wrongly written path also fails.
   */
  test("all declared `path`s point to something that exists", async () => {
    const raw = await readFile(join(REPO_ROOT, "delendai.config.json"), "utf8");
    const rutas = [...raw.matchAll(/"path"\s*:\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(rutas.length, "no plugin declares `path`").toBeGreaterThan(0);
    for (const ruta of rutas) {
      // `${workspaceFolder}` is expanded by the host, not by us.
      if (ruta.includes("${")) continue;
      const abs = join(REPO_ROOT, ruta.replace(/^\.\//, ""));
      await expect(stat(abs), `${ruta} does not exist`).resolves.toBeDefined();
    }
  });
});
