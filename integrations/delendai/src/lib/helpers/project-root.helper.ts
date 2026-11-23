import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { resolveWorkspaceContainedLexical, type IMcpPluginContext } from "@delendai/core/public";

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

/** Resolve tool arguments against the workspace and reuse validated roots per invocation. */
export async function createContainedProjectResolver(
  ctx: IMcpPluginContext,
): Promise<(rawPath: string, argument: string) => Promise<string>> {
  const workspace = ctx.workspace.root;
  const realWorkspace = await realpath(workspace);
  const paths = new Map<string, string>();
  return async (rawPath, argument) => {
    const path = resolvePluginPath(ctx, rawPath);
    const cached = paths.get(path);
    if (cached !== undefined) return cached;
    const physical = await resolveContainedRoot(workspace, realWorkspace, path, argument);
    paths.set(path, physical);
    return physical;
  };
}

async function resolveContainedRoot(
  workspace: string,
  realWorkspace: string,
  path: string,
  argument: string,
): Promise<string> {
  const lexical = resolveWorkspaceContainedLexical(workspace, relative(workspace, path));
  if (!lexical.ok) throw new Error(`${argument} debe estar dentro del workspace: ${path}`);

  const physical = await realpath(lexical.abs).catch((error: unknown) => {
    throw new Error(`${argument} debe ser un directorio legible: ${path}`, { cause: error });
  });
  if (!resolveWorkspaceContainedLexical(realWorkspace, relative(realWorkspace, physical)).ok) {
    throw new Error(`${argument} debe estar dentro del workspace: ${path}`);
  }
  return physical;
}
