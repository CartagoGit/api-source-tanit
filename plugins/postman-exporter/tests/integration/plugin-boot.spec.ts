/**
 * Arranque del plugin (p00013).
 *
 * El plugin se carga por su `path` desde `mcp-vertex.config.json`, así
 * que un fallo aquí no se ve hasta que el host MCP intenta arrancar y se
 * cae entero. Estos tests lo instancian igual que lo haría el host.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import plugin from "../../src/index";
import type { IMcpPluginContext } from "@mcp-vertex/core/public";

const PACKAGE_ROOT = resolve(__dirname, "../../../..");

function makeCtx(overrides: Partial<IMcpPluginContext> = {}): IMcpPluginContext {
  return {
    workspace: new URL(`file://${PACKAGE_ROOT}/`),
    namespacePrefix: "postman-exporter",
    options: {},
    ...overrides,
  } as IMcpPluginContext;
}

/** Los 4 tools que el plugin promete, por id. */
const EXPECTED_TOOLS = ["generate", "validate", "summary", "test"] as const;

describe("arranque del plugin", () => {
  test("declara nombre y versión", () => {
    expect(plugin.name).toBe("postman-exporter");
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("registra exactamente los 4 tools", () => {
    const { tools } = plugin.register(makeCtx());
    expect(tools.map((t) => t.id).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  test("cada tool trae su función register", () => {
    for (const tool of plugin.register(makeCtx()).tools) {
      expect(typeof tool.register).toBe("function");
    }
  });

  // Los efectos declarados son lo que el host usa para decidir si un
  // agente puede invocar el tool sin confirmación.
  test("los tools que escriben o lanzan procesos lo declaran", () => {
    const byId = new Map(plugin.register(makeCtx()).tools.map((t) => [t.id, t]));
    expect(byId.get("generate")?.effects).toContain("write");
    expect(byId.get("test")?.effects).toContain("spawn");
    // `summary` solo inspecciona: no debe declarar efectos.
    expect(byId.get("summary")?.effects ?? []).toEqual([]);
  });

  test("registrar dos veces no acumula estado", () => {
    const first = plugin.register(makeCtx()).tools.map((t) => t.id);
    const second = plugin.register(makeCtx()).tools.map((t) => t.id);
    expect(second).toEqual(first);
  });

  test("arranca con options vacías", () => {
    expect(() => plugin.register(makeCtx({ options: {} }))).not.toThrow();
  });

  test("arranca con las options declaradas en la config", () => {
    const ctx = makeCtx({
      options: {
        defaultProjectRoot: "/tmp/proyecto",
        cliScript: "/tmp/cli.ts",
      },
    } as Partial<IMcpPluginContext>);
    expect(plugin.register(ctx).tools).toHaveLength(4);
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

    const declared = config.plugins?.["postman-exporter"]?.path;
    expect(declared).toBeDefined();

    const entry = await import(resolve(PACKAGE_ROOT, declared!));
    expect(entry.default?.name).toBe("postman-exporter");
  });

  // El plugin `postman-exporter-testing` quedó superseded por el tool
  // `test`; su entrada en la config apuntaría a un directorio borrado y
  // tumbaría el arranque del host.
  test("no quedan plugins declarados que ya no existen", async () => {
    const config = JSON.parse(
      await readFile(resolve(PACKAGE_ROOT, "mcp-vertex.config.json"), "utf8"),
    ) as { plugins?: Record<string, unknown> };

    expect(Object.keys(config.plugins ?? {})).not.toContain("postman-exporter-testing");
  });
});
