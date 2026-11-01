/**
 * Import-path resolver — the adapter over `ModuleResolver`
 * (proposal `r00020` S1).
 *
 * This module used to be the resolver: it joined a relative path
 * with the directory of the importing file and produced a chain of
 * fallback candidates. It was **posix-shaped** — it only knew about
 * `/` — and it knew nothing about `tsconfig` aliases, package
 * exports, workspace packages or Windows drive letters.
 *
 * The resolution itself now lives in
 * `packages/core/module-resolution/resolver.service.ts`. This file is
 * the thin adapter that keeps the old surface:
 *
 *   - `resolveImportPath(fromFile, specifier, projectRoot)` returns
 *     the ordered list of paths the specifier could resolve to.
 *
 * The list is what a scanner wants: the scanner walks the file tree
 * and needs to know whether the import lands on a file that is part
 * of the project, and the first candidate that exists is the one
 * that does.
 *
 * A resolver per project root is kept in memory: building one reads
 * the `tsconfig.json` and the manifests of the project, and that
 * must not happen once per import.
 */
import { ModuleResolver } from "../module-resolution/resolver.service.js";
import type { IImportCandidate } from "../../contracts/interfaces/core/import-resolver.interface.js";

/**
 * Re-export so existing importers keep working with
 * `import { IImportCandidate } from "./import-resolver.js"`.
 */
export type { IImportCandidate };

/** One resolver per project root, built on first use. */
const resolvers = new Map<string, ModuleResolver>();

/**
 * The resolver of a project root.
 *
 * The root is the key: two files of the same project share the
 * `tsconfig`, the manifests and the workspace layout, and reading
 * them once is the difference between a scan that takes a second and
 * one that takes a minute.
 */
function resolverFor(projectRoot: string): ModuleResolver {
  const existing = resolvers.get(projectRoot);
  if (existing !== undefined) return existing;
  const created = new ModuleResolver({ projectRoot });
  resolvers.set(projectRoot, created);
  return created;
}

/**
 * The kind a candidate carries.
 *
 * A relative or absolute candidate keeps the old vocabulary — the
 * caller can tell the literal path from a fallback guess. A
 * candidate that came from a rule (`tsconfig` alias, package
 * exports, `node_modules`) carries the name of the rule, because
 * that is what the caller needs to know about it.
 */
function kindOf(candidate: {
  readonly kind: string;
  readonly form: string;
}): IImportCandidate["kind"] {
  if (candidate.kind === "relative" || candidate.kind === "absolute") {
    return candidate.form as IImportCandidate["kind"];
  }
  return candidate.kind as IImportCandidate["kind"];
}

/**
 * Resolve an import specifier against a source file.
 *
 * @param fromFile    Absolute path of the file that contains the
 *                    `import … from "…"` statement.
 * @param specifier   The raw specifier (between the quotes).
 * @param projectRoot Absolute path of the project root. It decides
 *                    which `tsconfig`, which workspace layout and
 *                    which `node_modules` chain apply.
 * @returns           The ordered candidates. The first one that
 *                    exists on disk is the file the import means.
 */
export function resolveImportPath(
  fromFile: string,
  specifier: string,
  projectRoot: string,
): ReadonlyArray<IImportCandidate> {
  if (specifier.length === 0) return [];
  const resolver = resolverFor(projectRoot);
  return resolver.candidates(specifier, fromFile).map((candidate) => ({
    path: candidate.path,
    kind: kindOf(candidate),
  }));
}
