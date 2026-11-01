/**
 * Monorepo workspace detection — f00011 S3.
 *
 * A **pure** helper (no state, no synchronous I/O) that returns the data shape
 * consumed by the orchestrator or pipeline. The signal that determines
 * "this is a monorepo" is checked in this order:
 *
 *   1. `turbo.json`               — Turborepo
 *   2. `pnpm-workspace.yaml`      — pnpm workspaces
 *   3. `lerna.json`               — Lerna (legacy package)
 *   4. `package.json#workspaces`  — npm/yarn workspaces (universal)
 *
 * The first match wins. All four are standard signals: if one is at the
 * project root, there is no reasonable doubt that the root does NOT contain
 * the API sources.
 *
 * ## What it returns
 *
 * - `signal`: the exact file read (used as the key for warnings).
 * - `workspaceDirs`: subdirectories resolved from the globs in the
 *   `workspaces` field (relative to `projectRoot`). Each entry is a single
 *   segment with no `..` or absolute components.
 * - `frameworkSearchRoot`: only when there is **exactly one** entry in
 *   `workspaceDirs`. With multiple entries, the helper returns `null` and
 *   the orchestrator leaves `match.frameworkSearchRoot` unset: choosing
 *   between `apps/api`, `apps/web`, and `packages/auth` is not a decision a
 *   scanner can make on its own.
 *
 * ## Why this is a separate helper
 *
 * The orchestrator exposes `detectAll(projectRoot)` through the
 * `IDiscoveryOrchestrator` interface (in `scanner.interface.ts`); that
 * signature accepts no options and cannot be extended without changing the
 * contract. Monorepo detection is tested with fixtures in this helper, and
 * the orchestrator invokes it once from the pipeline.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { IMonorepoDetection } from "../../contracts/interfaces/core/discovery.interface.js";
import { resolveWorkspaceGlobs } from "./workspace-glob.helper.js";

/**
 * Entry point: returns the detection result for a project root.
 *
 * `projectRoot` must be absolute (scanners and the pipeline have already
 * converted it). If a relative path is supplied, return "not a monorepo" with
 * `null` everywhere—the orchestrator should not have to guess which root is
 * meant.
 */
export async function detectMonorepo(
  projectRoot: string,
): Promise<IMonorepoDetection> {
  if (!projectRoot || !isAbsolute(projectRoot)) {
    return {
      isMonorepo: false,
      signal: null,
      workspaceDirs: [],
      frameworkSearchRoot: null,
    };
  }

  // Audit second review #6: separate two concepts:
  //   - "is monorepo" + `signal`: the presence of turbo.json /
  //     pnpm-workspace.yaml / lerna.json (in that order). The signal is what
  //     the UI displays for diagnostics.
  //   - "these are the packages": workspaces enumerated from the
  //     highest-priority source, falling back to package.json#workspaces when
  //     the highest-priority source is empty (a pure Turborepo case).
  //
  // Previously, `turbo.json` short-circuited the workspace search: if the
  // file existed but declared no workspaces, detection returned
  // `isMonorepo=true, workspaceDirs=[]` and never reached package.json. We now
  // fall back while preserving the signal.

  const hasTurbo = existsSync(join(projectRoot, "turbo.json"));
  const hasPnpm = existsSync(join(projectRoot, "pnpm-workspace.yaml"));
  const hasLerna = existsSync(join(projectRoot, "lerna.json"));

  // Signal: the first signal file present, in priority order. This is what the
  // UI displays and what the caller uses to understand "what kind of monorepo
  // this is".
  const signal =
    hasTurbo ? "turbo.json"
    : hasPnpm ? "pnpm-workspace.yaml"
    : hasLerna ? "lerna.json"
    : null;

  // Read workspaces from the highest-priority source (turbo > pnpm > lerna).
  // Only workspaces from that source are used, preserving the historical
  // "first signal wins its workspaces" contract.
  let primaryGlobs: ReadonlyArray<string> = [];
  if (hasTurbo) {
    primaryGlobs = await readJsonWorkspaces(join(projectRoot, "turbo.json"));
  } else if (hasPnpm) {
    primaryGlobs = await readPnpmWorkspaces(join(projectRoot, "pnpm-workspace.yaml"));
  } else if (hasLerna) {
    primaryGlobs = await readJsonWorkspaces(join(projectRoot, "lerna.json"));
  }

  // Fallback: the highest-priority source exists but has NO workspaces (a pure
  // Turborepo case). Fall back to universal package.json#workspaces while
  // preserving the signal from the file that is present.
  if (primaryGlobs.length === 0 && signal !== null) {
    const pkgGlobs = existsSync(join(projectRoot, "package.json"))
      ? await readPackageJsonWorkspaces(join(projectRoot, "package.json"))
      : [];
    if (pkgGlobs.length > 0) {
      return finalize(signal, pkgGlobs, projectRoot);
    }
    // A signal exists, but no source provides workspaces: presence without
    // materialization.
    return {
      isMonorepo: true,
      signal,
      workspaceDirs: [],
      frameworkSearchRoot: null,
    };
  }

  if (primaryGlobs.length > 0 && signal !== null) {
    return finalize(signal, primaryGlobs, projectRoot);
  }

  // Case C: there is no dedicated signal file either. Try package.json as the
  // only remaining option (an npm/yarn workspace project without
  // turbo/pnpm/lerna).
  if (existsSync(join(projectRoot, "package.json"))) {
    const pkgGlobs = await readPackageJsonWorkspaces(join(projectRoot, "package.json"));
    if (pkgGlobs.length > 0) {
      return finalize("package.json#workspaces", pkgGlobs, projectRoot);
    }
  }

  return {
    isMonorepo: false,
    signal: null,
    workspaceDirs: [],
    frameworkSearchRoot: null,
  };
}

async function finalize(
  signal: string,
  rawGlobs: ReadonlyArray<string>,
  projectRoot: string,
): Promise<IMonorepoDetection> {
  // 1) Normalize each glob (reject absolute paths and escapes with `..`) and
  //    deduplicate. Globs often overlap (`["apps/*", "apps/api"]`), and
  //    detection must not duplicate the result.
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const candidate of rawGlobs) {
    const normalized = normalizeRel(candidate);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      cleaned.push(normalized);
    }
  }
  if (cleaned.length === 0) {
    return {
      isMonorepo: true,
      signal,
      workspaceDirs: [],
      frameworkSearchRoot: null,
    };
  }
  // 2) Materialize the globs against the file system: `apps/*` → the real
  //    children of `apps` (`apps/api`, `apps/web`, …); `apps/api` →
  //    `apps/api` only if it exists. If the workspace is not materialized yet
  //    (a freshly cloned repo with no subdirectories), the result is `[]` —
  //    confusing "the workspace is empty" with "it is not a monorepo" would
  //    be worse. The resolver already deduplicates and sorts, so no second
  //    pass is needed.
  const resolved = await resolveWorkspaceGlobs(projectRoot, cleaned);
  return {
    isMonorepo: true,
    signal,
    workspaceDirs: resolved,
    frameworkSearchRoot: resolved.length === 1 ? resolved[0]! : null,
  };
}

/**
 * Normalizes a directory to POSIX-relative form without `.`, `..`, or absolute
 * components. Parser outputs use different forms (some with `./`, others with
 * `/`); normalize them to one consistent form here.
 *
 * POSIX normalization is implemented manually because the project depends on
 * neither `@types/node` nor `bun-types` — `runtime.d.ts` declares only the
 * minimum `node:path` API and nothing more. The four-line implementation avoids
 * adding a branch to ambient declarations and stays where it is understood,
 * next to the function that uses it.
 */
function normalizeRel(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (cleaned.length === 0 || cleaned.startsWith("/") || cleaned.startsWith("..")) {
    return null;
  }
  const normalized = collapsePosix(cleaned);
  if (normalized === "" || normalized === "." || normalized.startsWith("/")) {
    return null;
  }
  return normalized;
}

/**
 * Collapses `.` and `..` in a POSIX path without touching the file system.
 *
 * Contract:
 *  - `apps/api` → `apps/api`
 *  - `apps/../api` → `api` (one `..` that exits a segment remains)
 *  - `apps/../../api` → `../api` (escapes; `normalizeRel` rejects it)
 *
 * This is not a complete `path.posix.normalize` implementation (it does not
 * resolve `//` or remove redundant empty segments), but its inputs are
 * workspace globs that rarely contain those cases.
 */
function collapsePosix(input: string): string {
  const segments = input.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Collapse only when there is a segment to return to; otherwise keep
      // `..` and let `normalizeRel` reject it above.
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else {
        out.push("..");
      }
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * Reads workspaces from JSON (turbo.json / lerna.json / package.json).
 * Accepts:
 *
 *  - `workspaces: ["a", "b"]` (classic npm/yarn)
 *  - `workspaces: { packages: ["a", "b"] }` (npm 7+)
 *  - `packages: ["a", "b"]` (Lerna)
 *  - `workspaces: [...]` with `packages` (turbo) — merged
 *
 * Order matters: `packages` covers both Lerna and turbo; `workspaces` covers
 * npm/yarn. If both are present in the same file, concatenate them.
 */
async function readJsonWorkspaces(jsonPath: string): Promise<ReadonlyArray<string>> {
  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  const candidates: unknown[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) candidates.push(...value);
  };
  // 1) `workspaces` can be an array or `{ packages: [...] }`.
  collect(obj["workspaces"]);
  if (obj["workspaces"] && typeof obj["workspaces"] === "object" && !Array.isArray(obj["workspaces"])) {
    collect((obj["workspaces"] as Record<string, unknown>)["packages"]);
  }
  // 2) `packages` at the root (Lerna, or turbo when it does not use
  // `workspaces`).
  collect(obj["packages"]);
  return candidates.filter((c): c is string => typeof c === "string");
}

/**
 * Reads `pnpm-workspace.yaml` with a minimal parser. The only syntax we care
 * about is the `packages:` field with a list of globs.
 *
 * We do not add a yaml dependency because compiled binaries must not load
 * packages at runtime (`yaml.helper.ts` documents this rule). A ten-line parser
 * covers 100% of the `pnpm-workspace.yaml` files seen in practice. If syntax
 * this parser does not understand appears in the future, the helper returns
 * `[]` and the orchestrator keeps working; it simply does not auto-detect the
 * subdirectory.
 */
async function readPnpmWorkspaces(yamlPath: string): Promise<ReadonlyArray<string>> {
  let raw: string;
  try {
    raw = await readFile(yamlPath, "utf8");
  } catch {
    return [];
  }
  // Find the first `packages:` line and collect the following lines that start
  // with `  -`. Ignore nesting: pnpm permits catalog blocks, but those live in
  // a separate `pnpm-workspace.yaml` and are not needed here.
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages\s*:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    // A new root-level key ends the block.
    if (/^[A-Za-z_]/.test(line)) break;
    const match = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (!match || !match[1]) continue;
    const value = stripPnpmComment(match[1]).trim();
    const unquoted = value.replace(/^["']|["']$/g, "");
    if (unquoted.length > 0) out.push(unquoted);
  }
  return out;
}

/**
 * Removes an inline YAML comment only when it is outside quotes. This is done
 * manually because there is no YAML parser, and the case
 * `"apps/api" # comment` (the only quoted form found in real
 * `pnpm-workspace.yaml` files) cannot be handled by splitting on `#`.
 *
 * Heuristic: if the value starts with `"` or `'`, ignore `#` until the
 * matching quote is found; otherwise, cut at the first `#`.
 */
function stripPnpmComment(value: string): string {
  const first = value.charAt(0);
  if (first !== '"' && first !== "'") {
    const idx = value.indexOf("#");
    return idx === -1 ? value : value.slice(0, idx);
  }
  let out = first;
  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      out += ch + value[i + 1];
      i++;
      continue;
    }
    if (ch === first) return out + ch;
    out += ch;
  }
  return out;
}

/**
 * Package.json-specific variant: the key is `workspaces` (with no alias). npm
 * 7+ also accepts an object with `packages`; `readJsonWorkspaces` handles
 * that form.
 */
async function readPackageJsonWorkspaces(
  pkgPath: string,
): Promise<ReadonlyArray<string>> {
  return readJsonWorkspaces(pkgPath);
}

// Glob resolution moved to `workspace-glob.helper.ts` (a00012 S1.a): it no
// longer returns the prefix (`apps`), but the real subdirectories
// (`apps/api`, `apps/web`). The detector invokes it directly with `await`.