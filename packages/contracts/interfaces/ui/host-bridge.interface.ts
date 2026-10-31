/**
 * The connector between the app and the core.
 *
 * This is the **only** thing the app knows about the backend. It does
 * not know about Tauri, about crates, about stdio, about HTTP — it
 * knows operations, and it asks for them here.
 *
 * ## Why this file exists in this shape
 *
 * It used to declare thirteen operations in camelCase
 * (`openProject`, `listEndpoints`, `dryRun`…) that matched **nothing**:
 * not the Application API registry, not the CLI, not even the strings
 * the app itself sent over the wire. Three vocabularies were alive at
 * once — the registry's kebab-case, this map's camelCase, and the
 * literals in the clients — and the compiler could not tell, because
 * the clients had thrown the types away (`request(operation: string,
 * input: unknown)`).
 *
 * The result was that the app asked for **twelve** operations of which
 * **three** existed, and nothing said so until runtime.
 *
 * So the names here are now the registry's names, the inputs are the
 * registry's inputs, and the outputs are the registry's outputs. One
 * vocabulary, and the compiler enforces it: asking for an operation
 * that does not exist is a type error, not a runtime surprise.
 *
 * ## The operations that have no handler yet
 *
 * Some capabilities the CLI has (`check`, `push`, `validate`, `sync`)
 * are not behind a handler, so the app cannot reach them. They are
 * declared in `IPendingHostRequestMap` and asked for through
 * `requestPending()`, which says out loud that the call does not work
 * yet.
 *
 * That is not decoration. `scripts/gates/lint-cli-app-parity.script.ts`
 * reads the two: an operation asked for as pending that **already**
 * has a handler fails the build, so the backlog empties itself the
 * moment the handler lands.
 */
import type {
  BrowseInput,
  BrowseOutput,
  CancelInput,
  CancelOutput,
  CloseInput,
  CloseOutput,
  DryRunInput,
  DryRunOutput,
  ExportInput,
  ExportOutput,
  GetEndpointInput,
  GetEndpointOutput,
  GetSchemaInput,
  GetSchemaOutput,
  HistoryInput,
  HistoryOutput,
  ListEndpointsInput,
  ListEndpointsOutput,
  ListProjectsInput,
  ListProjectsOutput,
  ListServicesInput,
  ListServicesOutput,
  OpenProjectInput,
  OpenProjectOutput,
  SettingsInput,
  SettingsOutput,
  SnapshotInput,
  SnapshotOutput,
  WatchInput,
  WatchOutput,
} from "../core/application-api.interface.js";
import type { PendingAppOperation } from "../../constants/core/cli-app-parity.constant.js";

export type HostTheme = "light" | "dark";

/**
 * The operations the app can ask for, and what each one takes.
 *
 * The keys are the handler names — the same strings the dispatcher
 * looks up — so the wire needs no translation table.
 */
export interface IHostRequestMap {
  "open-project": OpenProjectInput;
  "snapshot": SnapshotInput;
  "list-endpoints": ListEndpointsInput;
  "get-endpoint": GetEndpointInput;
  "get-schema": GetSchemaInput;
  "list-services": ListServicesInput;
  "dry-run": DryRunInput;
  "export": ExportInput;
  "history": HistoryInput;
  "watch": WatchInput;
  "cancel": CancelInput;
  "settings": SettingsInput;
  "list-projects": ListProjectsInput;
  "close": CloseInput;
  /**
   * Listing folders.
   *
   * The one operation that answers before anything is open: it is
   * about the machine, not about a project.
   */
  "browse": BrowseInput;
}

/** What each operation answers. */
export interface IHostResponseMap {
  "open-project": OpenProjectOutput;
  "snapshot": SnapshotOutput;
  "list-endpoints": ListEndpointsOutput;
  "get-endpoint": GetEndpointOutput;
  "get-schema": GetSchemaOutput;
  "list-services": ListServicesOutput;
  "dry-run": DryRunOutput;
  "export": ExportOutput;
  "history": HistoryOutput;
  "watch": WatchOutput;
  "cancel": CancelOutput;
  "settings": SettingsOutput;
  "list-projects": ListProjectsOutput;
  "close": CloseOutput;
  "browse": BrowseOutput;
}

/**
 * Operations the CLI has and the Application API does not expose yet.
 *
 * The inputs are what the app already sends — they are the shape the
 * handlers will have to accept when they land, so declaring them here
 * means the call sites do not change when the handler appears.
 *
 * The answers are `unknown` on purpose: no handler exists, so there is
 * nothing to promise about the shape that comes back. The clients cast
 * it, and the cast is the marker of what is still missing.
 */
export interface IPendingHostRequestMap {
  check: { readonly projectRoot: string };
  sync: { readonly projectRoot: string };
  validate: { readonly projectRoot: string };
  push: {
    readonly projectRoot: string;
    readonly workspace?: string;
    readonly dryRun?: boolean;
  };
  "service-detail": { readonly projectRoot: string; readonly serviceId: string };
  "history-diff": {
    readonly projectRoot: string;
    readonly leftId: string;
    readonly rightId: string;
    readonly configuration?: Readonly<Record<string, unknown>>;
  };
  "history-compare-config": {
    readonly projectRoot: string;
    readonly leftId: string;
    readonly rightId: string;
  };
  "history-re-export": {
    readonly projectRoot: string;
    readonly historyId: string;
    readonly configuration?: Readonly<Record<string, unknown>>;
  };
  "history-restore": { readonly projectRoot: string; readonly historyId: string };
}

/**
 * The connector.
 *
 * `request` speaks the registry's vocabulary. `requestPending` speaks
 * the backlog's, and says out loud that the call does not work yet.
 */
export interface IHostBridge {
  request<K extends keyof IHostRequestMap>(
    operation: K,
    input: IHostRequestMap[K],
  ): Promise<IHostResponseMap[K]>;
  /**
   * Asks for an operation that has no handler yet.
   *
   * It answers `UNKNOWN_HANDLER` at runtime — which is the point: the
   * failure is visible in the code, in the gate, and in the backlog,
   * instead of hiding in a screen that quietly shows nothing.
   */
  requestPending<K extends PendingAppOperation>(
    operation: K,
    input: IPendingHostRequestMap[K],
  ): Promise<unknown>;
  /** Notifies about what the backend pushes (watch events). */
  subscribe(listener: (event: unknown) => void): () => void;
}
