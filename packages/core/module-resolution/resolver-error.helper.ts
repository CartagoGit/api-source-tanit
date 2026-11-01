/**
 * Structured resolution failures (proposal `r00020` S1).
 *
 * The resolver never answers "unresolved" with a silent empty list.
 * A caller that got nothing back has to be able to say **where** the
 * resolver looked, because that is the only thing that tells the
 * reader whether the problem is a missing dependency, a wrong alias
 * or a file that was never written.
 *
 * That is what `IResolverError` carries: the code, the specifier
 * that failed, and the list of probed paths.
 */
import type {
  IResolverError,
  ModuleResolutionErrorCode,
} from "../../contracts/interfaces/core/module-resolution.interface.js";

/**
 * Build a resolution failure.
 *
 * @param code       Machine-readable reason.
 * @param specifier  The specifier that failed, verbatim.
 * @param searchPaths Every path that was probed.
 * @param message    Human-readable explanation, in English.
 * @param fromFile   The importing file, when there was one.
 */
export function createResolverError(
  code: ModuleResolutionErrorCode,
  specifier: string,
  searchPaths: ReadonlyArray<string>,
  message: string,
  fromFile?: string,
): IResolverError {
  const error: IResolverError = {
    code,
    specifier,
    searchPaths: [...searchPaths],
    message,
  };
  return fromFile === undefined ? error : { ...error, fromFile };
}

/**
 * The failure of a specifier that matched nothing.
 *
 * The message names the specifier and the number of probed paths:
 * "searched 4 paths" is what a reader needs to trust that the
 * resolver did its job.
 */
export function notFoundError(
  specifier: string,
  searchPaths: ReadonlyArray<string>,
  fromFile?: string,
): IResolverError {
  const where = fromFile === undefined ? "" : ` from "${fromFile}"`;
  return createResolverError(
    "NOT_FOUND",
    specifier,
    searchPaths,
    `Cannot resolve "${specifier}"${where}. Searched ${searchPaths.length} path(s).`,
    fromFile,
  );
}

/**
 * The failure of a specifier that cannot be interpreted.
 *
 * An empty specifier, or one made only of separators, is not a
 * module: there is nothing to look for.
 */
export function invalidSpecifierError(
  specifier: string,
  fromFile?: string,
): IResolverError {
  const where = fromFile === undefined ? "" : ` from "${fromFile}"`;
  return createResolverError(
    "INVALID_SPECIFIER",
    specifier,
    [],
    `"${specifier}"${where} is not a module specifier.`,
    fromFile,
  );
}

/**
 * Whether a value is a structured resolution failure.
 *
 * The guard exists because the outcome is a union: a caller that
 * only wants the failures needs a way to tell them apart without
 * casting.
 */
export function isResolverError(value: unknown): value is IResolverError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { code?: unknown; specifier?: unknown };
  return typeof candidate.code === "string" && typeof candidate.specifier === "string";
}
