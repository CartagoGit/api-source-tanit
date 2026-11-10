/**
 * Module resolution contract (proposal `r00020` S1).
 *
 * The implementation lives in `packages/core/module-resolution/`.
 * The contract lives here because the resolver is consumed by more
 * than one package: the core discovery pass resolves imports to
 * concrete files, and the frameworks scanners need the same answers
 * for their own cross-file edges.
 *
 * ## What a resolver has to understand
 *
 * A Node/TypeScript project resolves a specifier through a chain of
 * rules that all live in files next to the code:
 *
 *   - `tsconfig.json` — `compilerOptions.baseUrl` and
 *     `compilerOptions.paths` (the `@/*` aliases).
 *   - `package.json` — the `exports` field (with its `import`,
 *     `require`, `node`, `browser` and `default` conditions), the
 *     `imports` field (the `#internal` aliases) and the
 *     `main`/`types` entry points.
 *   - the workspace layout — npm, yarn, pnpm and bun all hoist
 *     packages into a shared `node_modules`, and the workspace
 *     packages are reachable by their own name.
 *   - the filesystem — `node_modules` lookup walks up from the
 *     importing file, and every candidate has to be probed on disk
 *     (`.ts`, `.tsx`, `.d.ts`, `.js`, `index.*`).
 *
 * Plus the two path dialects that break naive resolvers: Windows
 * drive letters (`C:\app\src\main.ts`) and UNC shares
 * (`\\server\share\pkg`).
 */

/** How a path is written on disk. */
export type PathStyle =
  /** POSIX: `/app/src/main.ts`. */
  | "posix"
  /** Windows with a drive letter: `C:\app\src\main.ts`. */
  | "win32"
  /** Windows UNC share: `\\server\share\pkg`. */
  | "unc";

/**
 * The strategy that produced a resolution.
 *
 * It answers "why did this specifier land on this file?", which is
 * the question a reader asks when a `paths` alias shadows a real
 * directory.
 */
export type ModuleResolutionKind =
  /** `./x` or `../x`, resolved against the importing file. */
  | "relative"
  /** An absolute path (`/x`, `C:\x`, `\\server\share\x`). */
  | "absolute"
  /** `compilerOptions.baseUrl` + the specifier. */
  | "base-url"
  /** A `compilerOptions.paths` alias (`@/*`). */
  | "tsconfig-paths"
  /** A `package.json#imports` entry (`#internal`). */
  | "package-imports"
  /** A `package.json#exports` entry. */
  | "package-exports"
  /** The `main` (or `module`) entry of a package. */
  | "package-main"
  /** The `index.*` file of a package directory. */
  | "package-index"
  /** A package found in `node_modules`. */
  | "node-modules"
  /** A package that belongs to the workspace. */
  | "workspace";

/**
 * Why a resolution failed.
 *
 * There are only two reasons: the specifier was not a module, or
 * nothing matched it. A code that nothing produces is a code that
 * lies — a caller that switches on it never reaches the branch it
 * wrote, and nobody notices until the bug is reported.
 */
export type ModuleResolutionErrorCode =
  /** Nothing matched. The error carries the probed paths. */
  | "NOT_FOUND"
  /** The specifier is empty or cannot be interpreted at all. */
  | "INVALID_SPECIFIER";

/**
 * A structured resolution failure.
 *
 * The resolver never answers "unresolved" with a silent empty list:
 * a caller that wants to know *where* the resolver looked reads
 * `searchPaths`.
 */
export interface IResolverError {
  /** Machine-readable reason. */
  readonly code: ModuleResolutionErrorCode;
  /** The specifier that could not be resolved, verbatim. */
  readonly specifier: string;
  /** Every path that was probed, in probe order. */
  readonly searchPaths: ReadonlyArray<string>;
  /** Human-readable explanation, in English. */
  readonly message: string;
  /** The importing file, when the resolution started from one. */
  readonly fromFile?: string;
}

/** A successful resolution. */
export interface IModuleResolutionResult {
  /** Always `true` — discriminates the outcome union. */
  readonly ok: true;
  /** Absolute path of the resolved file. */
  readonly path: string;
  /** The strategy that produced it. */
  readonly kind: ModuleResolutionKind;
  /** The package the specifier belongs to, when it belongs to one. */
  readonly packageName?: string;
  /**
   * The subpath that was requested inside the package.
   *
   * `"."` is the root of the package. It is only set when the
   * resolution came from a package: a relative import or a
   * `tsconfig` alias belongs to no package.
   */
  readonly subpath?: string;
}

/** A failed resolution. */
export interface IModuleResolutionFailure {
  /** Always `false` — discriminates the outcome union. */
  readonly ok: false;
  /** The structured error. */
  readonly error: IResolverError;
}

/** What a resolution returns: one of the two, never a bare string. */
export type ModuleResolutionOutcome =
  | IModuleResolutionResult
  | IModuleResolutionFailure;

/** The `compilerOptions` subset the resolver cares about. */
export interface ITsconfigPaths {
  /** `compilerOptions.baseUrl`, resolved against the tsconfig dir. */
  readonly baseUrl?: string;
  /** `compilerOptions.paths`: alias pattern → target list. */
  readonly paths: Readonly<Record<string, ReadonlyArray<string>>>;
}

/** A package that belongs to the workspace (npm/yarn/pnpm/bun). */
export interface IWorkspacePackage {
  /** The package name, as declared in its `package.json`. */
  readonly name: string;
  /** Absolute path of the package directory. */
  readonly dir: string;
  /** The path of the package directory relative to the project root. */
  readonly relativeDir: string;
}

/** How the resolver should behave. */
export interface IModuleResolverOptions {
  /** Absolute path of the project root. */
  readonly projectRoot: string;
  /**
   * The `exports`/`imports` conditions, in priority order.
   *
   * Defaults to `["import", "require", "node", "default"]` — the
   * order Node itself uses, with `browser` available but not enabled
   * by default because a server-side scan is the common case.
   */
  readonly conditions?: ReadonlyArray<string>;
  /**
   * The extensions probed for a file, in order.
   *
   * Defaults to `.ts`, `.tsx`, `.d.ts`, `.mts`, `.cts`, `.js`, `.jsx`,
   * `.mjs`, `.cjs`, `.json`.
   */
  readonly extensions?: ReadonlyArray<string>;
  /**
   * Maps a Windows drive onto a local directory.
   *
   * A scan of a project that lives at `C:\app` on the developer's
   * machine, checked out at `/home/dev/app` on the build machine,
   * needs the two to be the same place. The key is the drive
   * (`"C:"`), the value an absolute local directory.
   */
  readonly driveRoots?: Readonly<Record<string, string>>;
}

/**
 * The resolver surface consumed outside `packages/core`.
 *
 * `candidates` is the filesystem-free half: it answers "where would
 * this specifier look?" and is what the pure import resolver uses.
 * `resolve` is the filesystem-backed half: it probes the candidates
 * and returns either a file or a structured error.
 */
export interface IModuleResolver {
  /**
   * Every path the specifier could resolve to, in probe order.
   *
   * Never touches the filesystem: a candidate that does not exist is
   * still a candidate.
   */
  candidates(
    specifier: string,
    fromFile: string,
  ): ReadonlyArray<IModuleCandidate>;
  /**
   * Resolve the specifier to a concrete file.
   *
   * Returns the structured failure when nothing matched — never a
   * silent empty result.
   */
  resolve(
    specifier: string,
    fromFile: string,
  ): ModuleResolutionOutcome;
  /** The paths that would be probed for the specifier. */
  searchPaths(
    specifier: string,
    fromFile: string,
  ): ReadonlyArray<string>;
}

/**
 * How a candidate path was produced.
 *
 * `literal` is the specifier itself, `extension-fallback` is the same
 * path with an extension added, and `index-fallback` is the
 * `index.*` file of a directory.
 */
export type ModuleCandidateForm =
  | "literal"
  | "extension-fallback"
  | "index-fallback";

/**
 * One place the resolver would look.
 *
 * `kind` says which rule produced the candidate, and `form` says how
 * the path itself was built — a caller can tell a real hit from a
 * fallback guess.
 */
export interface IModuleCandidate {
  /** Absolute path of the candidate. */
  readonly path: string;
  /** The rule that produced the candidate. */
  readonly kind: ModuleResolutionKind;
  /** How the path was built. */
  readonly form: ModuleCandidateForm;
  /** The package the candidate belongs to, when it belongs to one. */
  readonly packageName?: string;
  /**
   * The subpath requested inside the package.
   *
   * `"."` is the root of the package. It travels with the
   * candidate so that the resolution can report which subpath of
   * the package answered.
   */
  readonly subpath?: string;
}
