/**
 * Workspace packages (proposal `r00020` S1).
 *
 * A monorepo resolves a bare specifier to a **workspace** package
 * before it ever looks at `node_modules`: `import { orders } from
 * "@acme/orders"` has to land on `packages/orders/src/index.ts`, not
 * on a copy of that package that a registry happens to hold.
 *
 * Four package managers declare their workspaces, and three of them
 * use the same place:
 *
 *   - npm, yarn (classic and berry) and bun — the `workspaces` field
 *     of the root `package.json`, either as an array or as
 *     `{ packages: [...] }`.
 *   - pnpm — `pnpm-workspace.yaml`, with a `packages:` list.
 *
 * The patterns are globs (`packages/*`), so the resolver has to
 * expand them and read the `package.json` of every directory it
 * finds, to learn the **name** each workspace answers to. The name is
 * the thing the import uses; the directory is only where it lives.
 *
 * The filesystem access is injected: the resolver that owns this
 * service caches the manifests, and a test can pass a fake tree.
 */
import { isRecord, parseJson } from "../helpers/parse-json.helper.js";
import type { IWorkspacePackage } from "../../contracts/interfaces/core/module-resolution.interface.js";

/** The filesystem facts this service needs. */
interface IWorkspaceFileSystem {
  /** Reads a text file, or `null` when it does not exist. */
  readonly readTextFile: (absPath: string) => string | null;
  /** The names of the directories inside a directory. */
  readonly listDirectories: (absPath: string) => ReadonlyArray<string>;
}

/**
 * Read the `packages:` list of a `pnpm-workspace.yaml`.
 *
 * A full YAML parser is not worth it for a list of globs: the file
 * has one shape and the resolver only needs the strings.
 */
function readPnpmWorkspacePatterns(text: string): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  let inPackages = false;
  for (const raw of lines) {
    // The list is indented in a real `pnpm-workspace.yaml`, so the
    // line is trimmed before it is read.
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    if (line.length === 0) continue;
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const match = line.match(/^-\s+["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
      if (match && match[1]) {
        out.push(match[1].trim());
        continue;
      }
      // Any other key closes the `packages:` block.
      inPackages = !/^[^-\s]/.test(line);
      continue;
    }
  }
  return out;
}

/** The `workspaces` field of a `package.json`, in both of its shapes. */
function readNpmWorkspacePatterns(manifest: unknown): string[] {
  if (!isRecord(manifest)) return [];
  const workspaces = manifest["workspaces"];
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }
  if (isRecord(workspaces)) {
    const packages = workspaces["packages"];
    if (Array.isArray(packages)) {
      return packages.filter(
        (entry): entry is string => typeof entry === "string",
      );
    }
  }
  return [];
}

/** Match a directory name against a glob segment (`*` and `?`). */
function matchesSegment(pattern: string, name: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(name);
}

/**
 * Expand a workspace pattern into the directories it covers.
 *
 * Only the shapes a workspace declaration actually uses are handled:
 * a literal path, a glob in the last segment (`packages/*`) and the
 * recursive form (`packages/**`).
 */
function expandPattern(
  projectRoot: string,
  pattern: string,
  fs: IWorkspaceFileSystem,
): string[] {
  const segments = pattern.split("/").filter((s) => s.length > 0);
  let current: string[] = [projectRoot];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] ?? "";
    const isLast = index === segments.length - 1;
    const next: string[] = [];
    for (const dir of current) {
      if (segment === "**") {
        next.push(...walkDirectories(dir, fs, 0));
        continue;
      }
      if (!segment.includes("*") && !segment.includes("?")) {
        const candidate = `${dir}/${segment}`;
        if (!fs.listDirectories(dir).includes(segment)) continue;
        if (isLast && !hasManifest(candidate, fs)) continue;
        next.push(candidate);
        continue;
      }
      for (const name of fs.listDirectories(dir)) {
        if (!matchesSegment(segment, name)) continue;
        next.push(`${dir}/${name}`);
      }
    }
    current = next;
  }
  return current;
}

/** Every directory under `dir`, up to `maxDepth` levels down. */
function walkDirectories(
  dir: string,
  fs: IWorkspaceFileSystem,
  depth: number,
): string[] {
  if (depth > 3) return [];
  const out: string[] = [dir];
  for (const name of fs.listDirectories(dir)) {
    out.push(...walkDirectories(`${dir}/${name}`, fs, depth + 1));
  }
  return out;
}

/** Whether a directory holds a `package.json`. */
function hasManifest(dir: string, fs: IWorkspaceFileSystem): boolean {
  return fs.readTextFile(`${dir}/package.json`) !== null;
}

/**
 * The workspace packages of a project.
 *
 * The root project itself is **not** included: it is not a workspace
 * member, it is the project. A package that imports itself by name
 * is a mistake, not a resolution.
 *
 * @param projectRoot Absolute path of the project root.
 * @param fs          The filesystem facts to read with.
 */
export function detectWorkspacePackages(
  projectRoot: string,
  fs: {
    readonly readTextFile: (absPath: string) => string | null;
    readonly listDirectories: (absPath: string) => ReadonlyArray<string>;
  },
): ReadonlyArray<IWorkspacePackage> {
  const root = projectRoot.replace(/[/\\]+$/, "");
  const patterns: string[] = [];

  const rootManifest = fs.readTextFile(`${root}/package.json`);
  if (rootManifest !== null) {
    const parsed = parseJson(rootManifest);
    if (parsed.ok) patterns.push(...readNpmWorkspacePatterns(parsed.value));
  }

  const pnpmWorkspace = fs.readTextFile(`${root}/pnpm-workspace.yaml`);
  if (pnpmWorkspace !== null) {
    patterns.push(...readPnpmWorkspacePatterns(pnpmWorkspace));
  }

  const seen = new Set<string>();
  const out: IWorkspacePackage[] = [];
  for (const rawPattern of patterns) {
    const pattern = rawPattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (pattern.length === 0) continue;
    if (pattern.includes("..")) continue;
    for (const dir of expandPattern(root, pattern, fs)) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      const manifestText = fs.readTextFile(`${dir}/package.json`);
      if (manifestText === null) continue;
      const parsed = parseJson(manifestText);
      if (!parsed.ok || !isRecord(parsed.value)) continue;
      const name = parsed.value["name"];
      if (typeof name !== "string" || name.length === 0) continue;
      out.push({
        name,
        dir,
        relativeDir: dir.startsWith(`${root}/`)
          ? dir.slice(root.length + 1)
          : dir,
      });
    }
  }
  return out;
}
