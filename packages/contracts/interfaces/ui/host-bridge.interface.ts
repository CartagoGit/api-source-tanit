export type HostTheme = "light" | "dark";

export interface IHostRequestMap {
  openProject: { readonly path: string };
  rescan: undefined;
  search: { readonly query: string };
  export: { readonly format: string };
  settings: undefined;
}

export interface IHostResponseMap {
  openProject: { readonly projectRoot: string };
  rescan: { readonly refreshed: boolean };
  search: { readonly matches: ReadonlyArray<string> };
  export: { readonly outputPath: string | null };
  settings: { readonly saved: boolean };
}

export interface IHostBridge {
  request<K extends keyof IHostRequestMap>(
    operation: K,
    input: IHostRequestMap[K],
  ): Promise<IHostResponseMap[K]>;
  subscribe(listener: (event: unknown) => void): () => void;
}
