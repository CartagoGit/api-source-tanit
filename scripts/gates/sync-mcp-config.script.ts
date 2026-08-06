#!/usr/bin/env bun
/**
 * `bun run mcp:sync` — un solo sitio donde declarar los servidores MCP.
 *
 * Claude Code y VS Code leen ficheros distintos y con formatos
 * distintos, así que tener los dos a mano significa que en cuanto
 * cambias uno el otro se queda viejo y nadie se entera hasta que un
 * servidor no arranca:
 *
 *   .mcp.json          Claude Code   { "mcpServers": … }   rutas relativas
 *   .vscode/mcp.json   VS Code       { "servers": … }      ${workspaceFolder}
 *
 * Un enlace simbólico no sirve porque el contenido difiere, no solo la
 * ruta. Así que `.mcp.json` manda y este script deriva el de VS Code.
 *
 * Uso:
 *   bun run mcp:sync            regenera .vscode/mcp.json
 *   bun run mcp:sync --check    falla si han derivado (es `lint:mcp`)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { MCP_JSON, VSCODE_DIR, VSCODE_MCP_JSON } from "../helpers/root.helper.js";

/** Un servidor MCP, en lo que ambos formatos comparten. */
interface IServer {
  readonly type?: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
}

/**
 * Traduce una ruta relativa al proyecto a la variable de VS Code.
 *
 * Claude Code lanza el servidor con el cwd en la raíz del proyecto, así
 * que `.` y `./algo` funcionan tal cual. VS Code no garantiza el cwd:
 * necesita `${workspaceFolder}` explícito.
 */
function toVsCodeArg(arg: string): string {
  if (arg === ".") return "${workspaceFolder}";
  return arg
    .replace(/^--workspace=\.$/, "--workspace=${workspaceFolder}")
    .replace(/^(--[\w-]+=)\.\//, "$1${workspaceFolder}/")
    .replace(/^\.\//, "${workspaceFolder}/");
}

/** El fichero de VS Code que corresponde a un `.mcp.json` dado. */
function buildVsCodeConfig(source: { mcpServers: Record<string, IServer> }): string {
  const servers: Record<string, IServer> = {};
  for (const [name, server] of Object.entries(source.mcpServers)) {
    servers[name] = {
      ...server,
      ...(server.args ? { args: server.args.map(toVsCodeArg) } : {}),
    };
  }
  // El aviso va como comentario JSONC, no como campo del JSON: VS Code
  // valida este fichero contra su esquema y una clave que no conoce
  // sale marcada en el panel de problemas. `.vscode/mcp.json` sí admite
  // comentarios.
  return (
    "// Generado por `bun run mcp:sync` desde .mcp.json — NO lo edites a mano.\n" +
    "// Los servidores MCP se declaran una sola vez, en .mcp.json de la raíz.\n" +
    `${JSON.stringify({ servers }, null, 2)}\n`
  );
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const check = argv.includes("--check");

  let source: { mcpServers?: Record<string, IServer> };
  try {
    source = JSON.parse(await readFile(MCP_JSON, "utf8"));
  } catch (error) {
    console.error(`mcp:sync — no se pudo leer .mcp.json: ${String(error)}`);
    return 1;
  }
  if (!source.mcpServers || Object.keys(source.mcpServers).length === 0) {
    console.error("mcp:sync — .mcp.json no declara ningún servidor en `mcpServers`");
    return 1;
  }

  const expected = buildVsCodeConfig({ mcpServers: source.mcpServers });
  const current = await readFile(VSCODE_MCP_JSON, "utf8").catch(() => null);

  if (check) {
    if (current === expected) {
      const names = Object.keys(source.mcpServers).join(", ");
      console.log(`lint:mcp — .vscode/mcp.json al día con .mcp.json (${names})`);
      return 0;
    }
    console.error(
      "lint:mcp — .vscode/mcp.json no coincide con .mcp.json.\n" +
        "  Los servidores MCP se declaran UNA vez, en .mcp.json.\n" +
        "  Ejecuta `bun run mcp:sync` para regenerar el de VS Code.",
    );
    return 1;
  }

  await mkdir(VSCODE_DIR, { recursive: true });
  await writeFile(VSCODE_MCP_JSON, expected);
  console.log(
    current === expected
      ? "mcp:sync — .vscode/mcp.json ya estaba al día"
      : `mcp:sync — .vscode/mcp.json regenerado desde .mcp.json ` +
          `(${Object.keys(source.mcpServers).length} servidores)`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
