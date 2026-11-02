import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";

import { MCP_JSON, VSCODE_MCP_JSON } from "../../scripts/helpers/root.helper.js";
import { strictJsonProblem } from "../../scripts/gates/sync-mcp-config.script.js";

/**
 * Los dos ficheros de configuración MCP, leídos como los lee cualquiera.
 *
 * `JSON.parse` y nada más: es lo que usa el runtime de DelendAI al
 * arrancar para migrar la configuración del host. Con un `//` delante,
 * el arranque falla con "Unrecognized token '/'", el servidor sale con
 * código 1 y vuelve a intentarlo — y el síntoma que ve el usuario es
 * "the delendai server stopped while handling this request", que no
 * señala el fichero.
 */
describe("la configuración MCP tiene que ser JSON estricto", () => {
  test("`.mcp.json` parsea con JSON.parse", async () => {
    const raw = await readFile(MCP_JSON, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test("`.vscode/mcp.json` parsea con JSON.parse", async () => {
    const raw = await readFile(VSCODE_MCP_JSON, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test("`.vscode/mcp.json` no empieza por un comentario", async () => {
    const raw = await readFile(VSCODE_MCP_JSON, "utf8");
    expect(raw.trimStart().startsWith("//")).toBe(false);
    expect(raw.trimStart().startsWith("/*")).toBe(false);
  });

  test("el fichero de VS Code conserva los servidores de `.mcp.json`", async () => {
    const source = JSON.parse(await readFile(MCP_JSON, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    const derived = JSON.parse(await readFile(VSCODE_MCP_JSON, "utf8")) as {
      servers: Record<string, unknown>;
    };
    expect(Object.keys(derived.servers)).toEqual(Object.keys(source.mcpServers));
  });

  test("un comentario delante se reconoce como el problema que es", () => {
    const problem = strictJsonProblem('// generado\n{ "servers": {} }\n');
    expect(problem).not.toBeNull();
    expect(problem).toContain("comentario");
  });

  test("un JSON roto se nombra con su error", () => {
    const problem = strictJsonProblem("{ \"servers\": ");
    expect(problem).not.toBeNull();
    expect(problem).toContain("JSON");
  });

  test("un JSON válido no da problema", () => {
    expect(strictJsonProblem('{ "servers": {} }\n')).toBeNull();
  });
});
