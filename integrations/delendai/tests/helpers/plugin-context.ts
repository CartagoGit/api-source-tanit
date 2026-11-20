/**
 * Shared double of `IMcpPluginContext`.
 *
 * Before, each spec built its own by hand, and the three were all
 * different **and all three were wrong**: one passed
 * `new URL("file://…/")`, another `"file://" + process.cwd()`, and
 * the real contract is an `IWorkspacePathProvider`, i.e.
 * `{ root, resolve }`. Because the tools read the workspace with
 * `ctx.workspace.toString()`, in the tests it produced a plausible
 * path and in real execution it produced `"[object Object]"`. All
 * tools were broken against the host and the tests said they were
 * not.
 *
 * That is why this double's workspace is built with the core's real
 * factory (`createWorkspacePathProvider`) instead of being
 * imitated: if delendai changes the provider's shape, these tests
 * notice.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createWorkspacePathProvider,
  type IMcpPluginContext,
  type IToolRegistration,
} from "@delendai/core/public";

/** Prefix the host uses to qualify this plugin's tools. */
export const NAMESPACE_PREFIX = "tanit";

/** What can be overridden on a test context. */
export interface IMakeContextOptions {
  /** Absolute root of the workspace. */
  readonly workspaceRoot: string;
  /** Plugin options, as they would come from `delendai.config.json`. */
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

/** What an MCP tool's handler returns. */
export interface IToolCallResult {
  readonly content: ReadonlyArray<{ type: string; text: string }>;
  readonly isError?: boolean;
}

/** A tool's handler, already extracted from its registration. */
export type ToolHandler = (input: unknown) => Promise<IToolCallResult>;

/**
 * Registers a tool in a simulated MCP server and returns its handler.
 *
 * The real registration needs the host's server; here we only need
 * to keep the function so we can invoke it directly.
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
  // The only type assertion left in the repo, and it is here on
  // purpose.
  //
  // `register` expects the SDK's `McpServer`, a third-party type
  // with dozens of members this double does not implement: of all
  // of them, only `registerTool` is ever called. Implementing them
  // all to satisfy the compiler would amount to writing a fake SDK
  // from scratch, and that fake would lie more than this line.
  //
  // What makes it acceptable is that it lives **in one place**, in
  // a test helper, over a type we do not control.
  // `lint:no-type-escapes` whitelists it for this reason; any other
  // fails.
  await registration.register(server as never);
  if (!handler) throw new Error("el tool no registró ningún handler");
  return handler;
}

/** A captured tool with **its** declaration, not a copy. */
export interface ICapturedTool {
  /** Qualified name under which the host dispatches it. */
  readonly name: string;
  readonly handler: ToolHandler;
  /** The `outputSchema` as the tool registered it. */
  readonly outputSchema: unknown;
  readonly inputSchema: unknown;
}

/**
 * Registers a tool and returns the handler **and its declared schema**.
 *
 * `captureHandler` keeps only the function, which is enough to test
 * behaviour. This one is needed for the other side: confronting what
 * the handler returns with what the tool **says** it returns.
 * Comparing against a copy of the schema written into the test would
 * prove nothing — the two copies would drift together.
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
 * A registered plugin's tools.
 *
 * `IMcpPluginRegistrations.tools` is optional in the core contract,
 * but for this plugin it is not: if there are no tools, there is no
 * plugin. It is checked here once instead of repeating `?? []` in
 * each spec.
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
 * Root of the workspace the plugin inspects.
 *
 * It walks up looking for `delendai.config.json`, which is the host
 * project's marker — and not `package.json`, which the plugin
 * itself also has and which would stop too early.
 *
 * This used to be `resolve(__dirname, "../../../..")`. Counting
 * levels couples the file to its depth in the tree, and it has
 * already failed three times during this reorganisation: when
 * moving the gates, when moving the plugin into `packages/`, and
 * again when moving it into `packages/plugins/`. Each time the
 * failure was silent, because a wrong path does not throw: it
 * simply finds nothing.
 */
export function workspaceRoot(importMetaUrl: string): string {
  let dir = dirname(fileURLToPath(importMetaUrl));
  for (let up = 0; up < 12; up++) {
    if (existsSync(join(dir, "delendai.config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("delendai.config.json not found walking up from the test");
}

