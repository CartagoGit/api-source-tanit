import { isAbsolute, resolve } from "node:path";
import type { IMcpPluginContext } from "@mcp-vertex/core/public";

export function resolvePluginProjectRoot(
  ctx: IMcpPluginContext,
  requestedProjectRoot?: string,
): string {
  const workspaceRoot = ctx.workspace.root;
  const requested =
    requestedProjectRoot ??
    (ctx.options["defaultProjectRoot"] as string | undefined) ??
    workspaceRoot;

  return isAbsolute(requested)
    ? resolve(requested)
    : resolve(workspaceRoot, requested);
}

export function resolvePluginPath(
  ctx: IMcpPluginContext,
  requestedPath: string,
): string {
  return isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(ctx.workspace.root, requestedPath);
}
