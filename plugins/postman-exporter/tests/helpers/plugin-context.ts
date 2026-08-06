/**
 * Doble compartido de `IMcpPluginContext`.
 *
 * Antes cada spec se montaba el suyo a mano, y los tres eran distintos
 * **y los tres estaban mal**: uno pasaba `new URL("file://…/")`, otro un
 * `"file://" + process.cwd()`, y el contrato real es un
 * `IWorkspacePathProvider`, o sea `{ root, resolve }`. Como los tools
 * leían el workspace con `ctx.workspace.toString()`, en los tests salía
 * una ruta plausible y en ejecución real salía `"[object Object]"`.
 * Todos los tools estaban rotos contra el host y los tests decían que
 * no.
 *
 * Por eso el workspace de este doble se construye con la fábrica de
 * verdad del core (`createWorkspacePathProvider`) en vez de imitarla:
 * si mcp-vertex cambia la forma del proveedor, estos tests se enteran.
 */
import {
  createWorkspacePathProvider,
  type IMcpPluginContext,
  type IToolRegistration,
} from "@mcp-vertex/core/public";

/** Prefijo con el que el host cualifica los tools de este plugin. */
export const NAMESPACE_PREFIX = "postman-exporter";

/** Lo que se puede sobrescribir de un contexto de prueba. */
export interface IMakeContextOptions {
  /** Raíz absoluta del workspace. */
  readonly workspaceRoot: string;
  /** Options del plugin, tal como vendrían de `mcp-vertex.config.json`. */
  readonly options?: Record<string, unknown>;
  readonly namespacePrefix?: string;
}

/** Contexto de plugin con un workspace real apuntando a `workspaceRoot`. */
export function makeContext(options: IMakeContextOptions): IMcpPluginContext {
  return {
    workspace: createWorkspacePathProvider(options.workspaceRoot),
    namespacePrefix: options.namespacePrefix ?? NAMESPACE_PREFIX,
    options: options.options ?? {},
  } as IMcpPluginContext;
}

/** Lo que devuelve el handler de un tool MCP. */
export interface IToolCallResult {
  readonly content: ReadonlyArray<{ type: string; text: string }>;
  readonly isError?: boolean;
}

/** Handler de un tool, ya extraído de su registro. */
export type ToolHandler = (input: unknown) => Promise<IToolCallResult>;

/**
 * Registra un tool en un server MCP simulado y devuelve su handler.
 *
 * El registro de verdad necesita el server del host; aquí solo hace
 * falta quedarse con la función para poder invocarla directamente.
 */
export async function captureHandler(
  registration: IToolRegistration,
): Promise<ToolHandler> {
  let handler: ToolHandler | undefined;
  const server = {
    registerTool: (_name: string, _schema: unknown, fn: ToolHandler) => {
      handler = fn;
    },
  };
  // El `register` real espera el `McpServer` del SDK; aquí solo hace
  // falta el `registerTool`, así que se pasa el doble por `never`.
  await registration.register(server as never);
  if (!handler) throw new Error("el tool no registró ningún handler");
  return handler;
}

/**
 * Los tools de un plugin ya registrado.
 *
 * `IMcpPluginRegistrations.tools` es opcional en el contrato del core,
 * pero para este plugin no lo es: si no hay tools, no hay plugin. Se
 * comprueba aquí una vez en vez de repetir el `?? []` en cada spec.
 */
export async function registeredTools(
  plugin: { register: (ctx: IMcpPluginContext) => unknown },
  ctx: IMcpPluginContext,
): Promise<readonly IToolRegistration[]> {
  const registrations = (await plugin.register(ctx)) as {
    tools?: readonly IToolRegistration[];
  };
  if (!registrations.tools) throw new Error("el plugin no registró ningún tool");
  return registrations.tools;
}
