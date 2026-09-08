/**
 * Manifest reader — parses + caches the per-framework manifest files
 * the index knows about (f00016 S2).
 *
 * A "manifest" here is any file the scanners already read at scan
 * time: `package.json`, `tsconfig.json`, `go.mod`, `Cargo.toml`,
 * `composer.json`, `pyproject.toml`, `Gemfile`, `mix.exs`. Each of
 * these has its own format; each is parsed once per session, cached
 * by `relPath + hash`, and exposed via `manifestFor(relPath)`.
 *
 * The cached record carries the raw text (so consumers can re-parse
 * with their own dialect without going to disk), the structured
 * value when the format allows it, and the file's content hash (so
 * the invalidator can prove the cache is still truthful).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  isRecord,
  parseJson,
} from "../helpers/parse-json.helper.js";
import { sha256Of } from "./file-cache.service.js";

/** Formato de serialización detectado para un archivo de manifiesto. */
export type ManifestFormat = "json" | "yaml" | "toml" | "text";

/** Stable list of manifest file basenames the index recognises. */
export type ManifestType =
  | "package.json"
  | "tsconfig.json"
  | "go.mod"
  | "Cargo.toml"
  | "composer.json"
  | "pyproject.toml"
  | "Gemfile"
  | "mix.exs";

const MANIFEST_FILENAMES = new Set<string>([
  "package.json",
  "tsconfig.json",
  "go.mod",
  "Cargo.toml",
  "composer.json",
  "pyproject.toml",
  "Gemfile",
  "mix.exs",
]);

/**
 * A parsed manifest. `parsed` is `unknown` by design: each consumer
 * (`declaredDependencies`, the project loader, the workspace
 * resolver) asks the shape it needs and the reader does not invent a
 * second source of truth.
 */
export interface IManifest {
  readonly relPath: string;
  readonly absPath: string;
  readonly format: ManifestFormat;
  readonly type: ManifestType;
  readonly raw: string;
  /** Structured value when `format` is JSON / YAML / TOML; `undefined` otherwise. */
  readonly parsed?: unknown;
  /** SHA-256 of `raw` — used by the invalidator to drop stale entries. */
  readonly hashSha256: string;
}

const FORMAT_BY_FILENAME: Record<string, ManifestFormat> = {
  "package.json": "json",
  "tsconfig.json": "json",
  "go.mod": "text",
  "Cargo.toml": "toml",
  "composer.json": "json",
  "pyproject.toml": "toml",
  "Gemfile": "text",
  "mix.exs": "text",
};

/** Returns the basename of a posix-style path. */
function basename(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  return slash === -1 ? relPath : relPath.slice(slash + 1);
}

/** Returns `true` for files the reader knows how to handle. */
export function isManifestFile(relPath: string): boolean {
  return MANIFEST_FILENAMES.has(basename(relPath));
}

/**
 * Reads + parses a single manifest. Returns `null` when the file is
 * missing or unreadable, **or** when the file is not one of the
 * recognised manifest basenames — the caller passes a list of
 * candidate relPaths and the reader skips the rest.
 */
export async function readManifest(args: {
  readonly projectRoot: string;
  readonly relPath: string;
}): Promise<IManifest | null> {
  const base = basename(args.relPath);
  if (!MANIFEST_FILENAMES.has(base)) return null;
  const absPath = join(args.projectRoot, ...args.relPath.split("/"));
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    return null;
  }
  const hash = sha256Of(raw);
  const format = FORMAT_BY_FILENAME[base] ?? "text";
  const parsed = parseManifest(raw, format);
  const manifest: IManifest = {
    relPath: args.relPath,
    absPath,
    format,
    type: base as ManifestType,
    raw,
    hashSha256: hash,
  };
  if (parsed !== undefined) {
    return { ...manifest, parsed };
  }
  return manifest;
}

function parseManifest(raw: string, format: ManifestFormat): unknown | undefined {
  switch (format) {
    case "json": {
      const r = parseJson(raw);
      return r.ok ? r.value : undefined;
    }
    case "yaml":
      return parseSimpleYaml(raw);
    case "toml":
      return parseSimpleToml(raw);
    case "text":
      return undefined;
  }
}

/**
 * Minimal YAML reader for `packages:` lists inside
 * `pnpm-workspace.yaml` and similar. Anything more elaborate (nested
 * mappings, multi-line strings, anchors) falls back to `undefined`
 * — a full YAML parser is out of scope for S2 and the bench shows
 * nothing depends on it.
 */
function parseSimpleYaml(raw: string): unknown | undefined {
  const out: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);
  let currentList: string[] | null = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && listItem[1] !== undefined && currentList) {
      currentList.push(stripQuotes(listItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv && kv[1]) {
      const key = kv[1];
      const value = (kv[2] ?? "").trim();
      if (value === "") {
        out[key] = [];
        currentList = out[key] as string[];
      } else {
        out[key] = stripQuotes(value);
        currentList = null;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Minimal TOML reader — enough for the `Cargo.toml [workspace]`
 * block and the `pyproject.toml [tool.poetry]` block the workspace
 * resolver needs. Sections become nested objects; scalars become
 * strings; arrays of strings become `string[]`. Anything else falls
 * back to `undefined` and the consumer is told to read the raw text.
 */
function parseSimpleToml(raw: string): unknown | undefined {
  const root: Record<string, unknown> = {};
  const stack: Array<{ key: string; value: Record<string, unknown> }> = [
    { key: "", value: root },
  ];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      const path = (section[1] ?? "").split(".").map((s) => s.trim());
      let parent = root;
      for (const segment of path) {
        if (!isRecord(parent[segment])) parent[segment] = {};
        parent = parent[segment] as Record<string, unknown>;
      }
      stack[stack.length - 1] = { key: path[path.length - 1] ?? "", value: parent };
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*=\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1] ?? "";
    const value = (kv[2] ?? "").trim();
    const parent = stack[stack.length - 1]?.value ?? root;
    if (value.startsWith("[") && value.endsWith("]")) {
      const items = value
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0);
      parent[key] = items;
    } else if (value.startsWith('"') && value.endsWith('"')) {
      parent[key] = stripQuotes(value);
    } else {
      parent[key] = value;
    }
  }
  return root;
}

/**
 * Builds the initial manifest cache from a list of candidate
 * relPaths. Files that aren't manifests are silently dropped — that
 * is what the `isManifestFile` guard in `readManifest` guarantees.
 */
export async function readManifests(args: {
  readonly projectRoot: string;
  readonly relPaths: ReadonlyArray<string>;
}): Promise<Map<string, IManifest>> {
  const out = new Map<string, IManifest>();
  for (const relPath of args.relPaths) {
    const m = await readManifest({ projectRoot: args.projectRoot, relPath });
    if (m) out.set(relPath, m);
  }
  return out;
}

/**
 * Reads the manifest dependencies (the union of `dependencies`,
 * `devDependencies`, `peerDependencies`). Lives here because the
 * cache that already knows the parsed structure is the cheapest
 * source — the alternative was three different scanners parsing
 * `package.json` three different ways.
 */
export function declaredDependenciesFromManifest(
  manifest: IManifest,
): Record<string, string> {
  if (manifest.format !== "json") return {};
  const parsed = manifest.parsed;
  if (!isRecord(parsed)) return {};
  const out: Record<string, string> = {};
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const block = parsed[key];
    if (!isRecord(block)) continue;
    for (const [name, version] of Object.entries(block)) {
      if (typeof version === "string") out[name] ??= version;
    }
  }
  return out;
}

/** Re-export for callers that do not want to depend on parse-json. */
export { isRecord };