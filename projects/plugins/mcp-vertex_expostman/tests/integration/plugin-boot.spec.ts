/**
 * Arranque del plugin (p00013).
 *
 * El plugin se carga por su `path` desde `mcp-vertex.config.json`, así
 * que un fallo aquí no se ve hasta que el host MCP intenta arrancar y se
 * cae entero. Estos tests lo instancian igual que lo haría el host.
 */
import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import plugin from "../../src/index";
import { makeContext, registeredTools, workspaceRoot } from "../helpers/plugin-context";

const PACKAGE_ROOT = workspaceRoot(import.meta.url);

const makeCtx = (options: Record<string, unknown> = {}) =>
  makeContext({ workspaceRoot: PACKAGE_ROOT, options });

/** Los 4 tools que el plugin promete, por id. */
const EXPECTED_TOOLS = ["check", "generate", "validate", "summary", "test"] as const;

describe("arranque del plugin", () => {
  test("declara nombre y versión", () => {
    expect(plugin.name).toBe("expostman");
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("registra exactamente los 5 tools", async () => {
    const tools = await registeredTools(plugin, makeCtx());
    expect(tools.map((tool) => tool.id).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  test("cada tool trae su función register", async () => {
    for (const tool of await registeredTools(plugin, makeCtx())) {
      expect(typeof tool.register).toBe("function");
    }
  });

  // Los efectos declarados son lo que el host usa para decidir si un
  // agente puede invocar el tool sin confirmación.
  test("los tools que escriben o lanzan procesos lo declaran", async () => {
    const tools = await registeredTools(plugin, makeCtx());
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    expect(byId.get("generate")?.effects).toContain("write");
    expect(byId.get("test")?.effects).toContain("spawn");
    // `summary` solo inspecciona: no debe declarar efectos.
    expect(byId.get("summary")?.effects ?? []).toEqual([]);
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
    expect(await registeredTools(plugin, ctx)).toHaveLength(5);
  });

  test("declara un optionsSchema", () => {
    expect(plugin.optionsSchema).toBeDefined();
  });
});

describe("declaración en mcp-vertex.config.json", () => {
  test("el path del plugin apunta a un fichero que existe", async () => {
    const config = JSON.parse(
      await readFile(resolve(PACKAGE_ROOT, "mcp-vertex.config.json"), "utf8"),
    ) as { plugins?: Record<string, { path?: string }> };

    const declared = config.plugins?.["expostman"]?.path;
    expect(declared).toBeDefined();

    const entry = await import(resolve(PACKAGE_ROOT, declared!));
    expect(entry.default?.name).toBe("expostman");
  });

  // El plugin `export-to-postman-testing` quedó superseded por el tool
  // `test`; su entrada en la config apuntaría a un directorio borrado y
  // tumbaría el arranque del host.
  test("no quedan plugins declarados que ya no existen", async () => {
    const config = JSON.parse(
      await readFile(resolve(PACKAGE_ROOT, "mcp-vertex.config.json"), "utf8"),
    ) as { plugins?: Record<string, unknown> };

    expect(Object.keys(config.plugins ?? {})).not.toContain("export-to-postman-testing");
  });
});
