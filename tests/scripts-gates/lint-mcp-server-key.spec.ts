import { describe, expect, test } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { fromRoot } from "../../scripts/helpers/root.helper.js";
import {
  declaredServers,
  serverGrants,
  serverKeyProblems,
} from "../../scripts/gates/lint-mcp-server-key.script.js";

const AGENTS_DIR = fromRoot(".github", "agents");

describe("la clave del servidor MCP y los grants de los agentes", () => {
  test("`.mcp.json` declara el servidor con la clave `delendai-tanit`", async () => {
    const raw = await readFile(fromRoot(".mcp.json"), "utf8");
    expect(declaredServers(raw)).toEqual(["delendai-tanit"]);
  });

  test("`.vscode/mcp.json` declara los mismos servidores que `.mcp.json`", async () => {
    const root = declaredServers(await readFile(fromRoot(".mcp.json"), "utf8"));
    const vscode = declaredServers(await readFile(fromRoot(".vscode", "mcp.json"), "utf8"));
    expect(vscode).toEqual(root);
  });

  test("todos los agentes piden sus tools al servidor que existe", async () => {
    const entries = await readdir(AGENTS_DIR, { withFileTypes: true });
    const agents = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))
        .map(async (entry) => ({
          file: entry.name,
          source: await readFile(join(AGENTS_DIR, entry.name), "utf8"),
        })),
    );
    expect(agents.length).toBeGreaterThan(0);

    const root = declaredServers(await readFile(fromRoot(".mcp.json"), "utf8"));
    const vscode = declaredServers(await readFile(fromRoot(".vscode", "mcp.json"), "utf8"));
    expect(serverKeyProblems(agents, root, vscode)).toEqual([]);
  });

  test("cada agente concede al menos un grant de servidor", async () => {
    const entries = await readdir(AGENTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".agent.md")) continue;
      const source = await readFile(join(AGENTS_DIR, entry.name), "utf8");
      expect(serverGrants(source).length).toBeGreaterThan(0);
    }
  });
});

describe("el gate ve el drift", () => {
  test("un grant a un servidor que no existe es un problema, y lo nombra", () => {
    const problems = serverKeyProblems(
      [{ file: "x.agent.md", source: "tools: [read, delendai/*]" }],
      ["delendai-tanit"],
      ["delendai-tanit"],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("delendai/*");
    expect(problems[0]?.detail).toContain("delendai-tanit");
  });

  test("dos ficheros que declaran servidores distintos es un problema", () => {
    const problems = serverKeyProblems(
      [{ file: "x.agent.md", source: "tools: [read, delendai-tanit/*]" }],
      ["delendai-tanit"],
      ["delendai"],
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]?.detail).toContain("delendai-tanit");
    expect(problems[1]?.detail).toContain("delendai");
  });

  test("un grant que sí casa no da problema", () => {
    expect(
      serverKeyProblems(
        [{ file: "x.agent.md", source: "tools: [read, delendai-tanit/*]" }],
        ["delendai-tanit"],
        ["delendai-tanit"],
      ),
    ).toEqual([]);
  });

  test("una tool suelta no se confunde con un grant de servidor", () => {
    expect(serverGrants("tools: [read, search, execute, todo, edit]")).toEqual([]);
  });

  test("el grant se lee con o sin comillas", () => {
    expect(serverGrants('tools: ["delendai-tanit/*"]')).toEqual([
      { grant: "delendai-tanit/*", server: "delendai-tanit" },
    ]);
  });
});
