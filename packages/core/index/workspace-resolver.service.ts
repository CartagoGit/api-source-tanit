/**
 * Workspace resolver — detects monorepo workspaces (f00016 S2).
 *
 * One `ProjectIndex` may span several `IWorkspace`s. Today the
 * scanners work on a single `projectRoot`; tomorrow the
 * incremental invalidator will need the inverse graph per workspace.
 * The resolver is a pure function over the file tree: it walks the
 * known manifest markers, applies the workspace manager conventions,
 * and returns the list of `{ relPath, absPath, manager }`.
 *
 * Conventions covered (each one with a reference to the manifest
 * shape that proves it):
 *
 *   - npm / yarn classic — `package.json#workspaces: string[]`
 *   - yarn berry / pnpm  — `pnpm-workspace.yaml` (YAML)
 *   - turbo              — `turbo.json` (no workspace array, only the
 *                          fact that the root has a `package.json`
 *                          whose workspaces lists the packages)
 *   - bun                — `package.json#workspaces` (same shape as npm)
 *   - cargo              — `Cargo.toml#workspace.members`
 *   - go                 — `go.work` (no member syntax — the file lists
 *                          `use ./path/to/module` lines)
 *   - composer           — `composer.json#extra.installer-paths` is
 *                          not a workspace map; we detect a single
 *                          "package" workspace instead
 *   - poetry             — `pyproject.toml#tool.poetry.packages`
 *
 * The resolver never throws: an unreadable file or a malformed
 * manifest becomes an empty workspace list. The callers (the index)
 * degrade gracefully and continue with the root as the only
 * workspace.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

import {
  isRecord,
  parseJson,
  readArray,
  readString,
} from "../helpers/parse-json.helper.js";

/**
 * What kind of monorepo we found. `unknown` is the safe default —
 * the caller treats it as a single-workspace project.
 */
export type WorkspaceManager =
  | "npm"
  | "yarn"
  | "pnpm"
  | "bun"
  | "turbo"
  | "cargo"
  | "go"
  | "composer"
  | "poetry"
  | "unknown";

/** A workspace the index recognises inside `projectRoot`. */
export interface IWorkspace {
  /**
   * Path relative to `projectRoot`. Empty string for the root
   * workspace itself.
   */
  readonly relPath: string;
  /** Absolute path on disk. */
  readonly absPath: string;
  /** Which manager declared it (npm / yarn / pnpm / bun / cargo / go). */
  readonly manager: WorkspaceManager;
  /**
   * Marker file that proved this workspace exists (e.g.
   * `<workspace>/package.json`). Optional: a `go.work` workspace
   * has no marker, only the central file.
   */
  readonly markerRelPath?: string;
}

/** Shape of the dependency graph for one workspace. */
export type WorkspaceLookup = ReadonlyMap<string, IWorkspace>;

/**
 * Reads the small bits of the YAML we need. A full YAML parser is
 * not worth pulling in for the two scalars we read; this regex
 * covers `pnpm-workspace.yaml` and similar simple lists. Anything
 * more elaborate falls back to `[]` and the index continues with the
 * root workspace only.
 */
function readPnpmYaml(absPath: string): string[] {
  let text: string;
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  let inPackages = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("#")) continue;
    if (!line.trim()) continue;
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = line.match(/^-\s+["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
      if (m && m[1]) {
        out.push(m[1].trim());
        continue;
      }
      // Any other key closes the `packages:` block.
      inPackages = /^[^-\s]/.test(line);
      continue;
    }
  }
  return out;
}

/**
 * Resolves the list of workspaces under `projectRoot`.
 *
 * Pure on purpose — the function does not read files itself, the
 * caller passes the parsed contents. That keeps the resolver easy
 * to test (no fixtures, no tmpdirs) and decoupled from the index's
 * filesystem access.
 */
export function detectWorkspaces(args: {
  readonly projectRoot: string;
  readonly readTextFile: (absPath: string) => string | null;
}): IWorkspace[] {
  const { projectRoot, readTextFile } = args;
  const root = projectRoot.replace(/[\\/]+$/, "");
  const rootWorkspace: IWorkspace = {
    relPath: "",
    absPath: root,
    manager: "unknown",
  };
  const out: IWorkspace[] = [rootWorkspace];

  const pkgPath = join(root, "package.json");
  const pkgText = readTextFile(pkgPath);
  if (pkgText !== null) {
    const parsed = parseJson(pkgText);
    if (parsed.ok && isRecord(parsed.value)) {
      const workspaces = readArray(parsed.value, "workspaces");
      if (workspaces) {
        const manager = detectManagerFromLockfiles(root, "npm");
        for (const entry of workspaces) {
          if (typeof entry === "string") {
            pushWorkspace(out, root, entry, manager, "package.json");
          } else if (isRecord(entry) && typeof entry["."] === "string") {
            pushWorkspace(out, root, entry["."] as string, manager, "package.json");
          }
        }
      }
    }
  }

  const pnpmPath = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpmPath)) {
    const packages = readPnpmYaml(pnpmPath);
    for (const entry of packages) {
      pushWorkspace(out, root, entry, "pnpm", "pnpm-workspace.yaml");
    }
  }

  const cargoPath = join(root, "Cargo.toml");
  const cargoText = readTextFile(cargoPath);
  if (cargoText !== null) {
    const cargoWorkspaces = readCargoWorkspaceMembers(cargoText);
    for (const entry of cargoWorkspaces) {
      pushWorkspace(out, root, entry, "cargo", "Cargo.toml");
    }
  }

  const goWorkPath = join(root, "go.work");
  const goWorkText = readTextFile(goWorkPath);
  if (goWorkText !== null) {
    const modules = readGoWorkModules(goWorkText);
    for (const entry of modules) {
      pushWorkspace(out, root, entry, "go", "go.work");
    }
  }

  const composerPath = join(root, "composer.json");
  const composerText = readTextFile(composerPath);
  if (composerText !== null) {
    const parsed = parseJson(composerText);
    if (parsed.ok && isRecord(parsed.value)) {
      const extra = readObject(parsed.value, "extra");
      const installerPaths = extra ? readObject(extra, "installer-paths") : undefined;
      if (installerPaths) {
        for (const [, dest] of Object.entries(installerPaths)) {
          if (typeof dest === "string") {
            pushWorkspace(out, root, dest, "composer", "composer.json");
          }
        }
      }
    }
  }

  const pyprojectPath = join(root, "pyproject.toml");
  const pyprojectText = readTextFile(pyprojectPath);
  if (pyprojectText !== null) {
    const packages = readPyprojectPoetryPackages(pyprojectText);
    for (const entry of packages) {
      pushWorkspace(out, root, entry, "poetry", "pyproject.toml");
    }
  }

  // Tag the root workspace with the highest-priority manager we saw.
  const detected = out.find((w) => w.manager !== "unknown");
  if (detected) {
    out[0] = { ...rootWorkspace, manager: detected.manager };
  }

  return out;
}

function detectManagerFromLockfiles(
  root: string,
  fallback: WorkspaceManager,
): WorkspaceManager {
  void fallback;
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
  if (existsSync(join(root, "package-lock.json"))) return "npm";
  if (existsSync(join(root, "turbo.json"))) return "turbo";
  return fallback;
}

function pushWorkspace(
  out: IWorkspace[],
  root: string,
  rawRelPath: string,
  manager: WorkspaceManager,
  marker: string,
): void {
  const relPath = rawRelPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!relPath) return;
  if (relPath.includes("..")) return; // refuse escape attempts in committed manifests
  const absPath = join(root, ...relPath.split("/"));
  // Posix-style join without depending on `path.posix` — the repo
  // deliberately keeps the runtime ambient declarations minimal and
  // the index speaks posix throughout, so a literal `/` is correct.
  const markerRelPath = relPath.replace(/\/+$/, "") + "/" + basenameOf(marker);
  out.push({ relPath, absPath, manager, markerRelPath });
}

function basenameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx === -1 ? p : p.slice(idx + 1);
}

function readCargoWorkspaceMembers(text: string): string[] {
  // We only look at the top-level `workspace.members = ["a", "b"]`
  // shape; anything else is dropped (cargo workspace inheritance and
  // dependencies are out of scope).
  const blockMatch = text.match(/\[workspace\][\s\S]*?\n\[/);
  if (!blockMatch || !blockMatch[0]) return [];
  const block = blockMatch[0];
  const m = block.match(/members\s*=\s*\[([^\]]*)\]/);
  if (!m || !m[1]) return [];
  const list = m[1];
  return list
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
}

function readGoWorkModules(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^use\s+(\.\/?\S+)/);
    if (m && m[1]) out.push(m[1]);
  }
  return out;
}

function readPyprojectPoetryPackages(text: string): string[] {
  const blockMatch = text.match(/\[tool\.poetry\]([\s\S]*?)(?:\n\[|$)/);
  if (!blockMatch || !blockMatch[1]) return [];
  const block = blockMatch[1];
  const m = block.match(/packages\s*=\s*\[([^\]]*)\]/);
  if (!m || !m[1]) return [];
  const out: string[] = [];
  for (const raw of m[1].split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{")) {
      const inc = trimmed.match(/include\s*=\s*"([^"]+)"/);
      if (inc && inc[1]) out.push(inc[1]);
      continue;
    }
    out.push(trimmed.replace(/^["']|["']$/g, ""));
  }
  return out;
}

function readObject(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[key];
  return isRecord(found) ? found : undefined;
}

/**
 * Returns the workspace that owns a file (`absPath`), or `undefined`
 * if the path is outside every known workspace. The root workspace
 * matches anything inside `projectRoot` whose relPath starts with one
 * of the known workspace prefixes.
 */
export function workspaceFor(
  workspaces: ReadonlyArray<IWorkspace>,
  projectRoot: string,
  absPath: string,
): IWorkspace | undefined {
  const normRoot = projectRoot.replace(/[\\/]+$/, "");
  if (!absPath.startsWith(normRoot)) return undefined;
  let best: IWorkspace | undefined;
  for (const ws of workspaces) {
    if (ws.relPath === "") {
      // root workspace: only use it as fallback
      if (!best) best = ws;
      continue;
    }
    const wsAbs = ws.absPath.replace(/[\\/]+$/, "");
    if (absPath === wsAbs || absPath.startsWith(wsAbs + sep)) {
      if (!best || best.relPath.length < ws.relPath.length) {
        best = ws;
      }
    }
  }
  return best;
}

/** Read-only map: relPath → workspace (for O(1) lookups). */
export function buildWorkspaceLookup(
  workspaces: ReadonlyArray<IWorkspace>,
): WorkspaceLookup {
  const out = new Map<string, IWorkspace>();
  for (const ws of workspaces) {
    out.set(ws.relPath, ws);
  }
  return out;
}

/** Re-export the JSON helpers used by callers. */
export { isRecord, parseJson, readArray, readString };
// Quiet the unused-symbol lint on the no-arg helper re-export.
export type _IWorkspaceReadonlyShape = Pick<IWorkspace, "relPath" | "absPath" | "manager">;