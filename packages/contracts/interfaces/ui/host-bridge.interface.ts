export type HostTheme = "light" | "dark";

export interface IHostRequestMap {
  openProject: { readonly path: string };
  listEndpoints: { readonly projectRoot: string };
  dryRun: { readonly projectRoot: string; readonly formats?: ReadonlyArray<string> };
  rescan: undefined;
  search: { readonly query: string };
  export: { readonly format: string };
  historyDiff: { readonly projectRoot: string; readonly revision?: string };
  watch: { readonly projectRoot: string; readonly enabled: boolean };
  validate: { readonly projectRoot: string };
  check: { readonly projectRoot: string };
  sync: { readonly projectRoot: string };
  push: { readonly projectRoot: string };
  settings: undefined;
}

export interface IHostResponseMap {
  openProject: { readonly projectRoot: string };
  listEndpoints: { readonly endpoints: ReadonlyArray<string> };
  dryRun: { readonly files: ReadonlyArray<string>; readonly overwrites: number };
  rescan: { readonly refreshed: boolean };
  search: { readonly matches: ReadonlyArray<string> };
  export: { readonly outputPath: string | null };
  historyDiff: { readonly changed: boolean; readonly summary: string };
  watch: { readonly enabled: boolean };
  validate: { readonly valid: boolean; readonly issues: ReadonlyArray<string> };
  check: { readonly passed: boolean; readonly issues: ReadonlyArray<string> };
  sync: { readonly synced: boolean };
  push: { readonly pushed: boolean };
  settings: { readonly saved: boolean };
}

export interface IHostBridge {
  request<K extends keyof IHostRequestMap>(
    operation: K,
    input: IHostRequestMap[K],
  ): Promise<IHostResponseMap[K]>;
  subscribe(listener: (event: unknown) => void): () => void;
}
