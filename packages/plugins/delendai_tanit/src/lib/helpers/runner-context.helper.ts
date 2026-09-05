/**
 * Resolvers for `IRunnerContext`, consumed by `runner.helper`.
 *
 * The type lives in `contracts/interfaces/runner-context.interface.ts` and
 * the process snapshot in `contracts/constants/runner-snapshot.constant.ts`.
 * Only the cascade logic lives here.
 */
import type { IRunnerContext } from "../contracts/interfaces/runner-context.interface";
import { CWD_SNAPSHOT, ENV_SNAPSHOT } from "../contracts/constants/runner-snapshot.constant";

/** Resolves the effective cwd for the context. */
export function resolveCwd(ctx: IRunnerContext | undefined): string {
  const candidate = ctx?.cwd;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return CWD_SNAPSHOT;
}

/** Resolves the effective env for the context. */
export function resolveEnv(
  ctx: IRunnerContext | undefined,
): Readonly<Record<string, string | undefined>> {
  return ctx?.env ?? ENV_SNAPSHOT;
}

/** Resolves the effective bunBin for the context. */
export function resolveBunBinFromCtx(
  ctx: IRunnerContext | undefined,
): string | undefined {
  return ctx?.bunBin;
}
