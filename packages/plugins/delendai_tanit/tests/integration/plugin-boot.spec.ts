/**
 * Arranque del plugin (p00013).
 *
 * El plugin se carga por su `path` desde `delendai.config.json`, así
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
    // La cifra sale de `EXPECTED_TOOLS`, no escrita a mano: el `6`
    // literal que había aquí se quedó viejo al añadir `stats` y `scan`,
    // igual que la lista de tools del docblock del plugin decía tres
    // cuando ya había seis.
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

  // Los plugins superseded desaparecen del config para no tumbar el
  // arranque del host con una entrada a un directorio borrado. Hoy
  // la lista canónica de plugins está en `delendai.config.json`; este
  // test los cuenta para que un plugin olvidado salga como test
  // rojo en vez de como host muerto al boot.
  test("cuenta los plugins declarados en delendai.config.json", async () => {
    const config = JSON.parse(
      await readFile(resolve(PACKAGE_ROOT, "delendai.config.json"), "utf8"),
    ) as { plugins?: Record<string, unknown> };

    expect(Object.keys(config.plugins ?? {})).toContain("tanit");
  });
});
