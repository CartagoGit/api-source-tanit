#!/usr/bin/env bun
/**
 * `bun run lint:mcp-server-key` — que el nombre del servidor MCP y los
 * grants de los agentes no se separen.
 *
 * La clave con la que se registra un servidor MCP no es un adorno: es
 * la que **cualifica los nombres de las tools**. Un `.agent.md` que
 * concede `tools: [read, delendai/*]` pide las tools del servidor
 * llamado `delendai`, y si la clave se renombra a otra cosa el grant
 * sigue compilando, el agente sigue arrancando, y lo único que pasa es
 * que **el agente se queda sin tools MCP**.
 *
 * Eso es exactamente lo que pasó al renombrar el servidor a
 * `DelendAI:Tanit`: los cinco `.agent.md` pedían `delendai/*`, y no
 * había ningún gate que lo dijera. El síntoma —un subagente que no
 * encuentra `delendai_proposals_*`— no señala la causa.
 *
 * Qué se comprueba:
 *
 *   1. Todo grant `<servidor>/*` de un `.agent.md` nombra un servidor
 *      que está registrado en `.mcp.json`.
 *   2. `.mcp.json` y `.vscode/mcp.json` declaran los mismos
 *      servidores: el segundo se deriva del primero, y si sus nombres
 *      difieren el grant de los agentes casa con uno y no con el otro.
 *
 * Lo que NO se comprueba: que el servidor exista en la máquina de
 * quien abre el workspace. Eso lo dice el editor al arrancar.
 *
 * Uso:
 *   bun run lint:mcp-server-key
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { fromRoot } from "../helpers/root.helper.js";

/** Los ficheros que declaran a los agentes y sus tools. */
const AGENTS_DIR = fromRoot(".github", "agents");

/** La fuente de verdad: un servidor por clave. */
const MCP_JSON = fromRoot(".mcp.json");

/** El derivado que usa el editor. */
const VSCODE_MCP_JSON = fromRoot(".vscode", "mcp.json");

interface IProblem {
  readonly file: string;
  readonly detail: string;
}

/**
 * Un grant de tools que nombra un servidor: `delendai/*`.
 *
 * Se distingue de una tool suelta (`read`, `search`) porque aquél
 * lleva la barra y el asterisco. El nombre del servidor es lo que va
 * antes de la barra.
 */
const GRANT_DE_SERVIDOR = /^([A-Za-z0-9_:-]+)\/\*$/;

/** La línea `tools:` de un `.agent.md`. */
const LINEA_TOOLS = /^tools:\s*\[(.*)\]\s*$/;

/**
 * Los servidores que declara un fichero de configuración MCP.
 *
 * `.mcp.json` usa `mcpServers` (Claude Code) y `.vscode/mcp.json`
 * usa `servers` (VS Code): el mismo servidor, dos vocabularios.
 */
export function declaredServers(source: string): string[] {
  const parsed = JSON.parse(source) as Record<string, unknown>;
  for (const key of ["mcpServers", "servers"]) {
    const map = parsed[key];
    if (map !== null && typeof map === "object") return Object.keys(map as object).sort();
  }
  return [];
}

/**
 * Los grants que nombran un servidor, tal y como están escritos.
 *
 * Se devuelve el grant entero (`DelendAI:Tanit/*`) y el nombre del
 * servidor, porque el motivo del fallo tiene que decir las dos
 * cosas: qué se pidió y cuál era el bueno.
 */
export function serverGrants(source: string): Array<{ readonly grant: string; readonly server: string }> {
  const grants: Array<{ readonly grant: string; readonly server: string }> = [];
  for (const line of source.split("\n")) {
    const match = LINEA_TOOLS.exec(line.trim());
    if (match === null) continue;
    const items = (match[1] ?? "").split(",").map((item) => item.trim().replace(/^["']|["']$/g, ""));
    for (const item of items) {
      const server = GRANT_DE_SERVIDOR.exec(item);
      if (server !== null) grants.push({ grant: item, server: server[1] ?? "" });
    }
  }
  return grants;
}

/**
 * Los problemas de la configuración MCP y de los grants.
 *
 * Se separa del I/O para que el test pueda ejercitarlo con lo que
 * quiera: un grant a un servidor inexistente, dos ficheros que
 * declaran servidores distintos, un `.agent.md` sin `tools:`.
 */
export function serverKeyProblems(
  agents: ReadonlyArray<{ readonly file: string; readonly source: string }>,
  rootServers: readonly string[],
  vscodeServers: readonly string[],
): IProblem[] {
  const problems: IProblem[] = [];
  const known = new Set(rootServers.map((name) => name.toLowerCase().replace(/\s+/g, "-")));

  for (const { file, source } of agents) {
    for (const { grant, server } of serverGrants(source)) {
      if (!known.has(server)) {
        problems.push({
          file,
          detail:
            `concede "${grant}", pero no hay ningún servidor "${server}" registrado ` +
            `en .mcp.json (hay: ${known.size === 0 ? "ninguno" : rootServers.join(", ")}). ` +
            `Un grant que no casa con ninguna clave deja al agente sin sus tools MCP, ` +
            `y nada lo dice.`,
        });
      }
    }
  }

  const rootSet = new Set(rootServers);
  const vscodeSet = new Set(vscodeServers);
  for (const server of rootServers) {
    if (!vscodeSet.has(server)) {
      problems.push({
        file: ".vscode/mcp.json",
        detail: `no declara el servidor "${server}", que sí está en .mcp.json`,
      });
    }
  }
  for (const server of vscodeServers) {
    if (!rootSet.has(server)) {
      problems.push({
        file: ".vscode/mcp.json",
        detail: `declara el servidor "${server}", que no está en .mcp.json`,
      });
    }
  }

  return problems;
}

async function main(): Promise<number> {
  const rootServers = declaredServers(await readFile(MCP_JSON, "utf8"));
  const vscodeServers = declaredServers(await readFile(VSCODE_MCP_JSON, "utf8"));

  const entries = await readdir(AGENTS_DIR, { withFileTypes: true });
  const agents = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))
      .map(async (entry) => ({
        file: join(".github", "agents", entry.name),
        source: await readFile(join(AGENTS_DIR, entry.name), "utf8"),
      })),
  );

  const problems = serverKeyProblems(agents, rootServers, vscodeServers);

  if (problems.length > 0) {
    console.error(`lint:mcp-server-key — ${problems.length} deriva(s) encontrada(s):`);
    for (const problem of problems) {
      console.error(`  ✗ ${problem.file}: ${problem.detail}`);
    }
    return 1;
  }

  console.log(
    `lint:mcp-server-key — ${agents.length} agente(s) con grants que casan con ` +
      `${rootServers.length} servidor(es) (${rootServers.join(", ") || "ninguno"}).`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
