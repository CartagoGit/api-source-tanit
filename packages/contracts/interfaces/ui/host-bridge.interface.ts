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
 * There used to be a second vocabulary: the operations the app could
 * ask for but the core did not have, declared in
 * `IPendingHostRequestMap` and asked for through `requestPending()`.
 * That vocabulary is gone — the last of its operations
 * (`service-detail` and the four about the persisted history) became
 * handlers, and the backlog emptied itself.
 *
 * The gate that watched it is still there:
 * `scripts/gates/lint-cli-app-parity.script.ts` fails when an
 * operation the app asks for has no handler, so the list of things
 * the app cannot do cannot grow without anybody noticing.
 */
import type {
  BrowseInput,
  BrowseOutput,
  CancelInput,
  CancelOutput,
  CheckInput,
  CheckOutput,
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
  HistoryCompareConfigInput,
  HistoryCompareConfigOutput,
  HistoryDiffInput,
  HistoryDiffOutput,
  HistoryListInput,
  HistoryListOutput,
  HistoryReExportInput,
  HistoryReExportOutput,
  HistoryRestoreInput,
  HistoryRestoreOutput,
  ListEndpointsInput,
  ListEndpointsOutput,
  ListProjectsInput,
  ListProjectsOutput,
  ListServicesInput,
  ListServicesOutput,
  OpenProjectInput,
  OpenProjectOutput,
  PushInput,
  PushOutput,
  ServiceDetailInput,
  ServiceDetailOutput,
  SettingsInput,
  SettingsOutput,
  SnapshotInput,
  SnapshotOutput,
  StatsInput,
  StatsOutput,
  SyncInput,
  SyncOutput,
  ValidateInput,
  ValidateOutput,
  WatchInput,
  WatchOutput,
} from "../core/application-api.interface.js";

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
  /** One service, with everything known about it. */
  "service-detail": ServiceDetailInput;
  "dry-run": DryRunInput;
  "export": ExportInput;
  "history": HistoryInput;
  /** The persisted history: the revisions the project has been through. */
  "history-list": HistoryListInput;
  /** What changed between two revisions. */
  "history-diff": HistoryDiffInput;
  /** How two revisions were configured. */
  "history-compare-config": HistoryCompareConfigInput;
  /** A revision, exported again. */
  "history-re-export": HistoryReExportInput;
  /** A revision, restored. */
  "history-restore": HistoryRestoreInput;
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
  /** Has the collection drifted from the code? */
  "check": CheckInput;
  /** Is this a well-formed Postman collection? */
  "validate": ValidateInput;
  /** How many requests, and where. */
  "stats": StatsInput;
  /** Upload the collection to Postman. */
  "push": PushInput;
  /** Generate and write, in one verb. */
  "sync": SyncInput;
}

/** What each operation answers. */
export interface IHostResponseMap {
  "open-project": OpenProjectOutput;
  "snapshot": SnapshotOutput;
  "list-endpoints": ListEndpointsOutput;
  "get-endpoint": GetEndpointOutput;
  "get-schema": GetSchemaOutput;
  "list-services": ListServicesOutput;
  "service-detail": ServiceDetailOutput;
  "dry-run": DryRunOutput;
  "export": ExportOutput;
  "history": HistoryOutput;
  "history-list": HistoryListOutput;
  "history-diff": HistoryDiffOutput;
  "history-compare-config": HistoryCompareConfigOutput;
  "history-re-export": HistoryReExportOutput;
  "history-restore": HistoryRestoreOutput;
  "watch": WatchOutput;
  "cancel": CancelOutput;
  "settings": SettingsOutput;
  "list-projects": ListProjectsOutput;
  "close": CloseOutput;
  "browse": BrowseOutput;
  "check": CheckOutput;
  "validate": ValidateOutput;
  "stats": StatsOutput;
  "push": PushOutput;
  "sync": SyncOutput;
}

/**
 * The connector.
 *
 * `request` speaks the registry's vocabulary, and the compiler checks
 * it: asking for an operation that does not exist is a type error.
 */
export interface IHostBridge {
  request<K extends keyof IHostRequestMap>(
    operation: K,
    input: IHostRequestMap[K],
  ): Promise<IHostResponseMap[K]>;
  /** Notifies about what the backend pushes (watch events). */
  subscribe(listener: (event: unknown) => void): () => void;
}
