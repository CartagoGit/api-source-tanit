/**
 * Resolvedores del `IRunnerContext` para `runner.helper`.
 *
 * El tipo vive en `contracts/interfaces/runner-context.interface.ts` y
 * el snapshot del proceso en `contracts/constants/runner-snapshot.constant.ts`.
 * Aquí solo está la lógica de cascada.
 */
import type { IRunnerContext } from "../contracts/interfaces/runner-context.interface";
import { CWD_SNAPSHOT, ENV_SNAPSHOT } from "../contracts/constants/runner-snapshot.constant";

/** Resuelve el cwd efectivo del contexto. */
export function resolveCwd(ctx: IRunnerContext | undefined): string {
  const candidate = ctx?.cwd;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return CWD_SNAPSHOT;
}

/** Resuelve el env efectivo del contexto. */
export function resolveEnv(
  ctx: IRunnerContext | undefined,
): Readonly<Record<string, string | undefined>> {
  return ctx?.env ?? ENV_SNAPSHOT;
}

/** Resuelve el bunBin efectivo del contexto. */
export function resolveBunBinFromCtx(
  ctx: IRunnerContext | undefined,
): string | undefined {
  return ctx?.bunBin;
}
