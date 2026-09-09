import type { IImportRecord, ISymbolGraph } from "./symbol-graph.interface.js";

export type IndexedLanguage =
  | "typescript"
  | "javascript"
  | "tsx"
  | "jsx"
  | "go"
  | "rust"
  | "php"
  | "python"
  | "ruby"
  | "elixir"
  | "kotlin"
  | "csharp"
  | "json"
  | "yaml"
  | "toml"
  | "lock"
  | "graphql"
  | "unknown";

export type AstCapableLanguage = Extract<
  IndexedLanguage,
  "typescript" | "javascript" | "tsx" | "jsx"
>;

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

export interface IWorkspace {
  readonly relPath: string;
  readonly absPath: string;
  readonly manager: WorkspaceManager;
  readonly markerRelPath?: string;
}

export type WorkspaceLookup = ReadonlyMap<string, IWorkspace>;

export interface IIndexedFile {
  readonly relPath: string;
  readonly absPath: string;
  readonly size: number;
  readonly hashSha256: string;
  readonly language: IndexedLanguage;
  readonly workspace: IWorkspace;
}

export interface ICachedAst {
  readonly hashSha256: string;
  readonly ast: unknown;
  readonly language: AstCapableLanguage;
}

export interface IImportEdge {
  readonly importer: string;
  readonly imported: string;
}

export type ManifestFormat = "json" | "yaml" | "toml" | "text";

export type ManifestType =
  | "package.json"
  | "tsconfig.json"
  | "go.mod"
  | "Cargo.toml"
  | "composer.json"
  | "pyproject.toml"
  | "Gemfile"
  | "mix.exs";

export interface IManifest {
  readonly relPath: string;
  readonly absPath: string;
  readonly format: ManifestFormat;
  readonly type: ManifestType;
  readonly raw: string;
  readonly parsed?: unknown;
  readonly hashSha256: string;
}

export interface IProjectIndex {
  readonly root: string;
  readonly workspaces: ReadonlyArray<IWorkspace>;
  readonly fileCount: number;
  readonly astCount: number;
  readonly manifestCount: number;
  file(relPath: string): IIndexedFile | undefined;
  files(): ReadonlyArray<IIndexedFile>;
  astFor(relPath: string): unknown | undefined;
  manifestFor(relPath: string): IManifest | undefined;
  importsFor(relPath: string): ReadonlyArray<IImportRecord> | undefined;
  invalidate(relPath: string): ReadonlyArray<string>;
  invalidateAll(): void;
  close(): void;
}

export interface IProjectIndexOptions {
  readonly skipVendorDirs?: boolean;
  readonly eagerAst?: boolean;
  readonly astConcurrency?: number;
  readonly symbolGraph?: ISymbolGraph;
}