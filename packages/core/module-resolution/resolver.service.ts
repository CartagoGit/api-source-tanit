/**
 * `ModuleResolver` — the real module resolver (proposal `r00020` S1).
 *
 * The previous resolver (`packages/core/discovery/import-resolver.ts`)
 * only knew how to join a relative path with the directory of the
 * importing file. Everything else was out of scope: a `tsconfig`
 * alias, a `package.json#exports` condition, a workspace package, a
 * Windows drive letter. Each of those is a way of writing "this
 * import means that file", and a resolver that does not understand
 * them loses the symbol behind the import.
 *
 * ## The order of the rules
 *
 * A specifier is resolved with the first rule that matches, exactly
 * as Node and TypeScript do:
 *
 *   1. `#internal` — the `imports` field of the nearest package.
 *   2. `./x`, `../x` — relative to the importing file.
 *   3. `/x`, `C:\x`, `\\server\share\x` — absolute.
 *   4. `@/x` — a `compilerOptions.paths` alias.
 *   5. `x` with a `baseUrl` — relative to the `baseUrl`.
 *   6. `@acme/x` — a package of the workspace.
 *   7. `lodash` — a package of `node_modules`, walking up from the
 *      importing file (which is how hoisting works: the package may
 *      live in the root `node_modules` even when the importer is two
 *      directories deep).
 *
 * ## Two halves
 *
 * `candidates()` is the **pure** half: it says where the specifier
 * would look, without touching the filesystem. `resolve()` is the
 * **probing** half: it walks the candidates and returns the first
 * file that exists, or a structured error naming every path it
 * probed.
 *
 * The pure half is what the import resolver consumes (a scanner
 * wants the candidate chain, not a verdict), and it is what makes
 * the resolver testable without a filesystem.
 *
 * ## When the filesystem is read
 *
 * The manifests (the root `package.json`, the `tsconfig.json`, the
 * `package.json` of every package) are read **once**, when the
 * resolver is built. The resolution itself only probes for the
 * existence of files, which is what makes a thousand imports cost
 * milliseconds instead of seconds.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

import { isRecord, parseJson } from "../helpers/parse-json.helper.js";
import type {
  IModuleCandidate,
  IModuleResolver,
  IModuleResolverOptions,
  ITsconfigPaths,
  IWorkspacePackage,
  ModuleResolutionKind,
  ModuleResolutionOutcome,
} from "../../contracts/interfaces/core/module-resolution.interface.js";
import {
  applyDriveRoot,
  dirnamePath,
  isAbsolutePath,
  joinPath,
  normalizePath,
} from "./platform-paths.helper.js";
import {
  expandPathTargets,
  matchTsconfigPaths,
  parseTsconfigPaths,
} from "./tsconfig-paths.helper.js";
import {
  readPackageEntryPoints,
  resolvePackageExports,
  splitBareSpecifier,
} from "./package-exports.helper.js";
import { resolvePackageImports } from "./package-imports.helper.js";
import { detectWorkspacePackages } from "./workspace-resolver.service.js";
import {
  invalidSpecifierError,
  notFoundError,
} from "./resolver-error.helper.js";

/** The extensions probed for a file, in TypeScript's order. */
const DEFAULT_EXTENSIONS: ReadonlyArray<string> = [
  ".ts",
  ".tsx",
  ".d.ts",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
];

/**
 * The `exports`/`imports` conditions that are active by default.
 *
 * `browser` is not among them: the common case is a backend project,
 * and resolving to the browser bundle would be wrong. A caller that
 * scans a frontend passes its own list.
 */
const DEFAULT_CONDITIONS: ReadonlyArray<string> = [
  "import",
  "require",
  "node",
  "default",
];

/**
 * A path split into its bare form and the extension it carries.
 *
 * Only the **known** extensions count. `users.controller` is not a
 * file called `users` with the extension `.controller` — it is a file
 * called `users.controller`, and stripping that "extension" would
 * send the resolver looking for `users.ts`.
 */
function splitDeclaredExtension(
  path: string,
  extensions: ReadonlyArray<string>,
): { readonly bare: string; readonly extension: string } {
  const ordered = [...extensions].sort((a, b) => b.length - a.length);
  for (const extension of ordered) {
    if (!path.endsWith(extension)) continue;
    if (path.length === extension.length) continue;
    return { bare: path.slice(0, -extension.length), extension };
  }
  return { bare: path, extension: "" };
}

/**
 * Resolves module specifiers the way Node and TypeScript do.
 *
 * The class is cheap to build once and then reused: it reads the
 * manifests of the project when it is constructed, and caches every
 * resolution it has already computed.
 */
export class ModuleResolver implements IModuleResolver {
  private readonly projectRoot: string;
  private readonly tsconfigDir: string;
  private readonly conditions: ReadonlyArray<string>;
  private readonly extensions: ReadonlyArray<string>;
  private readonly driveRoots: Readonly<Record<string, string>>;
  private readonly tsconfig: ITsconfigPaths;
  private readonly rootPackageName: string | undefined;
  private readonly workspacePackages: ReadonlyMap<string, IWorkspacePackage>;
  private readonly manifests = new Map<string, unknown>();
  private readonly outcomes = new Map<string, ModuleResolutionOutcome>();

  /**
   * Build a resolver for a project.
   *
   * @param options The project root, the active conditions, the
   *                probed extensions and the drive mapping.
   */
  constructor(options: IModuleResolverOptions) {
    this.projectRoot = normalizePath(options.projectRoot);
    this.tsconfigDir = this.projectRoot;
    this.conditions = options.conditions ?? DEFAULT_CONDITIONS;
    this.extensions = options.extensions ?? DEFAULT_EXTENSIONS;
    this.driveRoots = options.driveRoots ?? {};
    this.tsconfig = this.readTsconfig();
    this.rootPackageName = this.readRootPackageName();
    const packages = detectWorkspacePackages(this.projectRoot, {
      readTextFile: (absPath) => this.readTextFile(absPath),
      listDirectories: (absPath) => this.listDirectories(absPath),
    });
    this.workspacePackages = new Map(packages.map((p) => [p.name, p]));
  }

  /**
   * Every path the specifier could resolve to, in probe order.
   *
   * No filesystem access: a candidate that does not exist is still a
   * candidate, and the caller decides what to do with it.
   */
  public candidates(
    specifier: string,
    fromFile: string,
  ): ReadonlyArray<IModuleCandidate> {
    if (specifier.length === 0) return [];
    if (specifier.startsWith("#")) {
      return this.packageImportCandidates(specifier, fromFile);
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return this.fileCandidates(
        joinPath(dirnamePath(fromFile), specifier),
        "relative",
      );
    }
    if (isAbsolutePath(specifier)) {
      return this.absoluteCandidates(specifier);
    }
    return this.bareCandidates(specifier, fromFile);
  }

  /**
   * Resolve the specifier to a file that exists.
   *
   * Returns the structured failure when nothing matched: the error
   * names the specifier and every path that was probed.
   */
  public resolve(
    specifier: string,
    fromFile: string,
  ): ModuleResolutionOutcome {
    if (specifier.length === 0) {
      return { ok: false, error: invalidSpecifierError(specifier, fromFile) };
    }
    const key = JSON.stringify([fromFile, specifier]);
    const cached = this.outcomes.get(key);
    if (cached !== undefined) return cached;

    const candidates = this.candidates(specifier, fromFile);
    const probed: string[] = [];
    for (const candidate of candidates) {
      probed.push(candidate.path);
      if (!isFile(candidate.path)) continue;
      const outcome: ModuleResolutionOutcome = {
        ok: true,
        path: candidate.path,
        kind: candidate.kind,
        ...(candidate.packageName === undefined
          ? {}
          : { packageName: candidate.packageName }),
      };
      this.outcomes.set(key, outcome);
      return outcome;
    }

    const failure: ModuleResolutionOutcome = {
      ok: false,
      error: notFoundError(specifier, probed, fromFile),
    };
    this.outcomes.set(key, failure);
    return failure;
  }

  /** The paths that would be probed for the specifier. */
  public searchPaths(
    specifier: string,
    fromFile: string,
  ): ReadonlyArray<string> {
    return this.candidates(specifier, fromFile).map((c) => c.path);
  }

  // --- candidates -------------------------------------------------------

  /**
   * The candidates of a path: the path itself, the same path with
   * every extension, and the `index.*` of the directory.
   */
  private fileCandidates(
    base: string,
    kind: ModuleResolutionKind,
    packageName?: string,
  ): ReadonlyArray<IModuleCandidate> {
    const out: IModuleCandidate[] = [];
    const owner = packageName === undefined ? {} : { packageName };
    const normalized = normalizePath(base);
    out.push({ path: normalized, kind, form: "literal", ...owner });
    const { bare, extension } = splitDeclaredExtension(
      normalized,
      this.extensions,
    );
    for (const ext of this.extensions) {
      if (ext === extension) continue;
      out.push({
        path: `${bare}${ext}`,
        kind,
        form: "extension-fallback",
        ...owner,
      });
    }
    for (const ext of this.extensions) {
      out.push({
        path: `${bare}/index${ext}`,
        kind,
        form: "index-fallback",
        ...owner,
      });
    }
    return out;
  }

  /** The candidates of an absolute path, in any dialect. */
  private absoluteCandidates(specifier: string): ReadonlyArray<IModuleCandidate> {
    const mapped = applyDriveRoot(specifier, this.driveRoots, this.projectRoot);
    return this.fileCandidates(mapped, "absolute");
  }

  /** The candidates of a `#internal` alias. */
  private packageImportCandidates(
    specifier: string,
    fromFile: string,
  ): ReadonlyArray<IModuleCandidate> {
    const packageDir = this.findNearestPackageDir(fromFile);
    if (packageDir === null) return [];
    const manifest = this.readManifest(`${packageDir}/package.json`);
    if (manifest === null) return [];
    const importsField = isRecord(manifest) ? manifest["imports"] : undefined;
    const target = resolvePackageImports(
      importsField,
      specifier,
      this.conditions,
    );
    if (target === null) return [];
    if (target.startsWith("./")) {
      return this.fileCandidates(
        joinPath(packageDir, target),
        "package-imports",
      );
    }
    return this.bareCandidates(target, `${packageDir}/package.json`);
  }

  /** The candidates of a bare specifier. */
  private bareCandidates(
    specifier: string,
    fromFile: string,
  ): ReadonlyArray<IModuleCandidate> {
    const out: IModuleCandidate[] = [];

    const matched = matchTsconfigPaths(this.tsconfig.paths, specifier);
    if (matched !== null) {
      const targets = this.tsconfig.paths[matched.pattern] ?? [];
      const baseDir = this.tsconfig.baseUrl ?? this.tsconfigDir;
      for (const target of expandPathTargets(targets, matched.capture, baseDir)) {
        out.push(...this.fileCandidates(target, "tsconfig-paths"));
      }
    }

    if (this.tsconfig.baseUrl !== undefined) {
      out.push(
        ...this.fileCandidates(
          joinPath(this.tsconfig.baseUrl, specifier),
          "base-url",
        ),
      );
    }

    const { packageName, subpath } = splitBareSpecifier(specifier);
    if (
      this.rootPackageName !== undefined &&
      packageName === this.rootPackageName
    ) {
      // Node's self-reference: a package that declares `exports`
      // may import itself by its own name.
      out.push(
        ...this.packageCandidates(
          this.projectRoot,
          subpath,
          "workspace",
          packageName,
        ),
      );
    }
    const workspace = this.workspacePackages.get(packageName);
    if (workspace !== undefined) {
      out.push(
        ...this.packageCandidates(
          workspace.dir,
          subpath,
          "workspace",
          packageName,
        ),
      );
    }

    for (const dir of this.nodeModulesSearchDirs(fromFile)) {
      out.push(
        ...this.packageCandidates(
          `${dir}/node_modules/${packageName}`,
          subpath,
          "node-modules",
          packageName,
        ),
      );
    }

    return out;
  }

  /**
   * The candidates of a package directory.
   *
   * The `exports` field wins over everything else: when a package
   * declares it, the package is saying "this is what you may
   * import", and a subpath that is not in the map is not importable
   * at all.
   */
  private packageCandidates(
    packageDir: string,
    subpath: string,
    kind: ModuleResolutionKind,
    packageName: string,
  ): ReadonlyArray<IModuleCandidate> {
    const out: IModuleCandidate[] = [];
    const manifest = this.readManifest(`${packageDir}/package.json`);
    if (manifest === null) {
      // The package is not installed. The candidates are still the
      // paths where it WOULD be: a caller that wants to know where
      // the resolver looked needs them, and a package that is
      // missing has no `exports` to honour.
      const base =
        subpath === "." ? packageDir : joinPath(packageDir, subpath);
      return this.fileCandidates(base, kind, packageName);
    }

    const exportsField = isRecord(manifest) ? manifest["exports"] : undefined;
    if (exportsField !== undefined) {
      const target = resolvePackageExports(
        exportsField,
        subpath,
        this.conditions,
      );
      if (target === null) return out;
      if (target.startsWith("./")) {
        return this.fileCandidates(
          joinPath(packageDir, target),
          "package-exports",
          packageName,
        );
      }
      return this.bareCandidates(target, `${packageDir}/package.json`);
    }

    if (subpath !== ".") {
      return this.fileCandidates(
        joinPath(packageDir, subpath),
        kind === "workspace" ? "workspace" : "node-modules",
        packageName,
      );
    }

    const entries = readPackageEntryPoints(manifest);
    if (entries.types !== undefined) {
      out.push(
        ...this.fileCandidates(
          joinPath(packageDir, entries.types),
          "package-main",
          packageName,
        ),
      );
    }
    if (entries.module !== undefined) {
      out.push(
        ...this.fileCandidates(
          joinPath(packageDir, entries.module),
          "package-main",
          packageName,
        ),
      );
    }
    if (entries.main !== undefined) {
      out.push(
        ...this.fileCandidates(
          joinPath(packageDir, entries.main),
          "package-main",
          packageName,
        ),
      );
    }
    out.push(
      ...this.fileCandidates(
        joinPath(packageDir, "index"),
        "package-index",
        packageName,
      ),
    );
    return out;
  }

  // --- project context --------------------------------------------------

  /**
   * The `node_modules` directories that are searched for a package.
   *
   * The walk starts at the directory of the importing file and goes
   * up to the project root: that is how hoisting works — a package
   * installed at the root is visible from every directory below.
   */
  private nodeModulesSearchDirs(fromFile: string): ReadonlyArray<string> {
    const out: string[] = [];
    let dir = dirnamePath(fromFile);
    for (let depth = 0; depth < 64; depth++) {
      out.push(dir);
      if (dir === this.projectRoot) break;
      const parent = dirnamePath(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return out;
  }

  /**
   * The directory of the package that owns a file.
   *
   * The nearest `package.json` walking up from the file: the
   * `imports` field belongs to the package, not to the project.
   */
  private findNearestPackageDir(fromFile: string): string | null {
    let dir = dirnamePath(fromFile);
    for (let depth = 0; depth < 64; depth++) {
      if (this.readManifest(`${dir}/package.json`) !== null) return dir;
      if (dir === this.projectRoot) break;
      const parent = dirnamePath(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  /** The name the project declares for itself, if it declares one. */
  private readRootPackageName(): string | undefined {
    const manifest = this.readManifest(`${this.projectRoot}/package.json`);
    if (manifest === null) return undefined;
    const name = isRecord(manifest) ? manifest["name"] : undefined;
    return typeof name === "string" && name.length > 0 ? name : undefined;
  }

  /** The `paths` and `baseUrl` of the project tsconfig. */
  private readTsconfig(): ITsconfigPaths {
    const tsconfigPath = `${this.projectRoot}/tsconfig.json`;
    const raw = this.readTextFile(tsconfigPath);
    if (raw === null) return { paths: {} };
    return parseTsconfigPaths(raw, this.tsconfigDir);
  }

  // --- filesystem -------------------------------------------------------

  /** Read a text file, or `null` when it does not exist. */
  private readTextFile(absPath: string): string | null {
    if (!existsSync(absPath)) return null;
    try {
      return readFileSync(absPath, "utf8");
    } catch {
      return null;
    }
  }

  /** The names of the directories inside a directory. */
  private listDirectories(absPath: string): ReadonlyArray<string> {
    if (!existsSync(absPath)) return [];
    try {
      return readdirSync(absPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  /** Read and parse a `package.json`, cached by path. */
  private readManifest(absPath: string): unknown | null {
    const cached = this.manifests.get(absPath);
    if (cached !== undefined) return cached;
    const raw = this.readTextFile(absPath);
    const parsed = raw === null ? null : parseJson(raw);
    const value = parsed === null || !parsed.ok ? null : parsed.value;
    this.manifests.set(absPath, value);
    return value;
  }
}

/** Whether a path points to a file that exists. */
function isFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

