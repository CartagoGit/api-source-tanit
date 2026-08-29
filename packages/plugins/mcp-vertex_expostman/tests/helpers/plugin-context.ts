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
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createWorkspacePathProvider,
  type IMcpPluginContext,
  type IToolRegistration,
} from "@mcp-vertex/core/public";

/** Prefijo con el que el host cualifica los tools de este plugin. */
export const NAMESPACE_PREFIX = "expostman";

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
  // La única aserción de tipo que queda en el repo, y está aquí a
  // propósito.
  //
  // `register` espera el `McpServer` del SDK, un tipo de terceros con
  // decenas de miembros que este doble no va a implementar: de todos
  // ellos solo se llama a `registerTool`. Implementarlos todos para
  // satisfacer al compilador sería escribir un SDK falso entero, y ese
  // falso mentiría más que esta línea.
  //
  // Lo que la hace aceptable es que está **en un sitio**, en un helper
  // de tests, sobre un tipo que no controlamos. `lint:no-type-escapes`
  // la tiene declarada con este motivo; cualquier otra falla.
  await registration.register(server as never);
  if (!handler) throw new Error("el tool no registró ningún handler");
  return handler;
}

/** Un tool capturado con **su** declaración, no con una copia. */
export interface ICapturedTool {
  /** Nombre cualificado con el que lo despacha el host. */
  readonly name: string;
  readonly handler: ToolHandler;
  /** El `outputSchema` tal y como el tool lo registró. */
  readonly outputSchema: unknown;
  readonly inputSchema: unknown;
}

/**
 * Registra un tool y devuelve el handler **y su esquema declarado**.
 *
 * `captureHandler` se queda solo con la función, que basta para probar
 * el comportamiento. Esto hace falta para lo otro: confrontar lo que el
 * handler devuelve con lo que el tool **dice** que devuelve. Comparar
 * contra una copia del esquema escrita en el test no comprobaría nada —
 * las dos copias se separarían juntas.
 */
export async function captureTool(
  registration: IToolRegistration,
): Promise<ICapturedTool> {
  let capturado: ICapturedTool | undefined;
  const server = {
    registerTool: (
      name: string,
      schema: { outputSchema?: unknown; inputSchema?: unknown },
      fn: ToolHandler,
    ) => {
      capturado = {
        name,
        handler: fn,
        outputSchema: schema.outputSchema,
        inputSchema: schema.inputSchema,
      };
    },
  };
  await registration.register(server as never);
  if (!capturado) throw new Error("el tool no registró ningún handler");
  return capturado;
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

/**
 * Raíz del workspace que el plugin inspecciona.
 *
 * Sube buscando `mcp-vertex.config.json`, que es el marcador del
 * proyecto host — y no `package.json`, que lo tiene también el propio
 * plugin y pararía demasiado pronto.
 *
 * Antes esto era `resolve(__dirname, "../../../..")`. Contar niveles
 * acopla el fichero a su profundidad en el árbol, y ya ha fallado tres
 * veces en esta reorganización: al mover los gates, al mover el plugin
 * a `packages/`, y otra vez al meterlo en `packages/plugins/`. Cada vez
 * el fallo fue silencioso, porque una ruta equivocada no lanza: solo no
 * encuentra nada.
 */
export function workspaceRoot(importMetaUrl: string): string {
  let dir = dirname(fileURLToPath(importMetaUrl));
  for (let up = 0; up < 12; up++) {
    if (existsSync(join(dir, "mcp-vertex.config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("No se encontró mcp-vertex.config.json subiendo desde el test");
}

