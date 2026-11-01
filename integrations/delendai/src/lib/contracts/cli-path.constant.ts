/**
 * Where the CLI this plugin executes lives.
 *
 * The plugin does NOT import the CLI: it **spawns** it, so the only
 * thing they share is a hand-written path. And a hand-written path
 * goes stale without anyone noticing.
 *
 * What happened: when we reorganised into `packages/`, the CLI moved
 * from `scripts/` to `packages/cli/`, and this string was left behind
 * in three places (the two tools and `delendai.config.json`) pointing
 * to a non-existent file. Nothing failed the gates —
 * `runBunScript` returns `ok: false` with "module not found", and that
 * only shows up when actually running the tool against the host. In
 * other words: the two tools that write artefacts were shipping broken
 * commits and the tests stayed green because none of them ever
 * actually spawned anything.
 *
 * Now the path lives in one place and `cli-path.constant.spec.ts`
 * verifies the file exists. Moving the CLI again breaks a gate instead
 * of breaking whoever uses the plugin.
 */

/**
 * Path to the CLI entrypoint, relative to the workspace root.
 *
 * `/` separators on purpose: it composes with `${workspaceRoot}/…` and
 * both Bun and Node accept them on Windows too.
 */
export const CLI_SCRIPT_RELATIVE = "packages/cli/cli.script.ts" as const;

/**
 * The CLI entrypoint for a given workspace.
 *
 * `override` is the `cliScript` option from `delendai.config.json`:
 * whoever installed the package elsewhere can say so. Without it, the
 * workspace is assumed to BE the Tanit repository.
 */
export function resolveCliScript(
  workspaceRoot: string,
  override?: string | undefined,
): string {
  if (override && override.length > 0) return override;
  return `${workspaceRoot}/${CLI_SCRIPT_RELATIVE}`;
}
