/**
 * The map between the CLI, the Application API and the desktop app.
 *
 * ## The problem this map solves
 *
 * The product has two faces: the **CLI** (`apisrc <command>`) and the
 * **desktop app** (Angular, in `packages/app`). The CLI is the
 * reference for what the tool can do; the app is the same tool with a
 * face instead of commands.
 *
 * That was the intent, and the code says so — `docs/CLI.md` carries a
 * "GUI action | CLI command | Output and diagnostics" table. But the
 * intent was never checked, and the drift it allowed was total:
 *
 *   · The app asked the bridge for **twelve** operations. **Three**
 *     existed. The other nine answered `UNKNOWN_HANDLER` — three
 *     quarters of the calls could not work, and nothing said so.
 *   · The contract the app used (`IHostRequestMap`) declared thirteen
 *     operations in camelCase that matched **nothing**: neither the
 *     CLI, nor the Application API registry, nor the strings the app
 *     actually sent.
 *   · `packages/app/src/app/core/api/endpoints.client.ts` returned
 *     **five thousand invented endpoints** and the export client wrote
 *     to a `Map` in memory. The screens looked finished and were
 *     showing fiction.
 *   · Not one of the app's eleven features was mounted in the shell.
 *
 * A map nobody verifies is a wish. This one is checked by
 * `scripts/gates/lint-cli-app-parity.script.ts`, which fails when:
 *
 *   · a CLI command is not in the map — a new command with no app
 *     counterpart is invisible drift;
 *   · a map entry names an Application API handler that does not
 *     exist — the map is claiming a capability that is not there;
 *   · the app asks the bridge for an operation that is neither in the
 *     API nor declared in `PENDING_APP_OPERATIONS` — a call that would
 *     answer `UNKNOWN_HANDLER` at runtime;
 *   · a pending operation **already exists** in the API — the
 *     backlog entry has expired and the app has to use it;
 *   · a pending operation the app no longer asks for — the backlog is
 *     lying.
 *
 * The last two are what make the list of pending work a list that
 * empties itself: it cannot rot.
 *
 * ## How to read a status
 *
 *   · `covered` — the capability is reachable from the CLI **and**
 *     from the app, through the API.
 *   · `partial` — reachable, but not with the same depth or the same
 *     options. The note says what is missing.
 *   · `gap` — the CLI has it; the app cannot reach it at all.
 *
 * A `gap` is not a bug in the map; it is the map doing its job. The
 * honest thing is to write it down, not to pretend the two faces are
 * equal when they are not.
 */
/** How much of a capability each face can reach. */
export type ParityStatus = "covered" | "partial" | "gap";

/** One capability, seen from the CLI, the API and the app. */
export interface IParityCapability {
  /** What the user can do. Named after the action, not the code. */
  readonly capability: string;
  /** The CLI commands that cover it. */
  readonly cli: readonly string[];
  /**
   * The Application API handlers that cover it.
   *
   * These are names of the registry — `HANDLER_NAMES` in
   * `application-api.constant.ts` — and the gate checks every one of
   * them against it. A handler that does not exist yet is **not**
   * written here: that is what `PENDING_APP_OPERATIONS` is for.
   */
  readonly api: readonly string[];
  /**
   * The operations the app asks the bridge for.
   *
   * Same rule as `api`: a name that is not a registered handler is a
   * pending operation, and it belongs in `PENDING_APP_OPERATIONS`.
   */
  readonly app: readonly string[];
  readonly status: ParityStatus;
  /** What is missing, or why it is shaped the way it is. */
  readonly note: string;
}

/**
 * The capabilities, face by face.
 *
 * The `cli` lists are checked against the commands the CLI really
 * dispatches — the `COMMANDS` record in `packages/cli/cli.script.ts`:
 * a command that does not exist is a typo the gate catches, and a
 * command that exists but appears in no entry is drift the gate also
 * catches.
 */
export const CLI_APP_PARITY: readonly IParityCapability[] = [
  {
    capability: "generate",
    cli: ["generate", "sync"],
    api: ["export", "dry-run"],
    app: ["export", "dry-run"],
    status: "covered",
    note:
      "The same pipeline the CLI generates with, and the same " +
      "exporters. The dry run answers with the files that would be " +
      "written and whether each would overwrite something; the export " +
      "writes them, atomically. The `export` handler used to answer " +
      "`bytes: 0` without writing anything, and the Export Center " +
      "drew a preview of a file that was never created.",
  },
  {
    capability: "detect",
    cli: ["scan", "list"],
    api: ["snapshot", "list-endpoints", "list-services", "get-endpoint", "get-schema"],
    app: ["snapshot", "list-endpoints", "list-services", "get-endpoint", "get-schema"],
    status: "covered",
    note:
      "The explorer asks the backend and draws what comes back. It used " +
      "to draw a fixture of five thousand invented endpoints, with an " +
      "auth scheme nobody detected and a source file that did not " +
      "exist; the filters were applied to that fiction, in the client, " +
      "over a list the client had made up.",
  },
  {
    capability: "drift",
    cli: ["check"],
    api: [],
    app: [],
    status: "gap",
    note:
      "`check` compares a generated collection against the routes in the " +
      "code. The comparison lives in the CLI; no Application API handler " +
      "exposes it, so the app cannot reach it.",
  },
  {
    capability: "validate",
    cli: ["validate"],
    api: [],
    app: [],
    status: "gap",
    note:
      "Validating a collection against the Postman v2.1.0 schema is " +
      "CLI-only. No handler exposes it.",
  },
  {
    capability: "push",
    cli: ["push"],
    api: [],
    app: [],
    status: "gap",
    note:
      "The upload logic exists in the core " +
      "(`packages/core/domain/postman-api.service.ts`) and the CLI uses " +
      "it, but it is not behind a handler, so the app cannot call it.",
  },
  {
    capability: "watch",
    cli: ["watch"],
    api: ["watch", "cancel"],
    app: ["watch"],
    status: "covered",
    note:
      "The app subscribes through the bridge and cancels through the " +
      "same registry the CLI uses.",
  },
  {
    capability: "history",
    cli: ["history"],
    api: ["history"],
    app: ["history"],
    status: "partial",
    note:
      "The session's own events — the snapshot taken, the files that " +
      "changed under it — are reachable from both. The **persisted** " +
      "history, the past generations with their hashes, is not: " +
      "comparing two revisions, re-exporting a past one and restoring " +
      "it are core capabilities with no handler yet, and the app asks " +
      "for them as pending so the gap is visible.",
  },
  {
    capability: "stats",
    cli: ["stats"],
    api: [],
    app: [],
    status: "gap",
    note:
      "Counts per method and folder. `snapshot` carries the totals, but " +
      "not the breakdown the CLI prints.",
  },
  {
    capability: "projects",
    cli: [],
    api: ["open-project", "list-projects", "close"],
    app: ["open-project", "close"],
    status: "covered",
    note:
      "Opening a project opens a **session**: the backend scans it and " +
      "answers with the summary the app draws from. The app used to set " +
      "the project's *name* and stop there, so every operation behind " +
      "it answered `SESSION_NOT_FOUND`.",
  },
  {
    capability: "settings",
    cli: [],
    api: ["settings"],
    app: [],
    status: "partial",
    note:
      "The API reads and patches the settings. The app keeps its own in " +
      "the browser's secure storage instead.",
  },
  {
    capability: "interface",
    cli: ["ui"],
    api: [],
    app: [],
    status: "covered",
    note:
      "Not a business capability: the CLI command that opens the web " +
      "interface. It is a carrier, and it is listed so the gate can see " +
      "that every command is accounted for.",
  },
  {
    capability: "service",
    cli: ["serve"],
    api: [],
    app: [],
    status: "covered",
    note:
      "Also a carrier: the Application API as a long-lived process. The " +
      "handlers it exposes are listed in the capabilities above, not " +
      "here.",
  },
];

/**
 * Operations the app asks for that the Application API does not have.
 *
 * This is the honest list of what the app cannot do yet, and it is
 * **checked**, not a comment:
 *
 *   · an operation here that **already exists** in the registry fails
 *     the gate — the app has to use it and take it off this list;
 *   · an operation the app no longer asks for fails the gate — this
 *     list has to shrink with the app;
 *   · an operation the app asks for that is in **neither** place fails
 *     the gate — that call would answer `UNKNOWN_HANDLER`.
 *
 * Every entry here is a call that does not work yet. The list is where
 * the work is, and it is allowed to shrink.
 *
 * The type is derived from the list, not written beside it: the
 * connector's pending-operation type is this union, so adding an entry
 * here is what makes it *possible* to ask for that operation — and
 * impossible to ask for one that is not on the list.
 */
export const PENDING_APP_OPERATIONS = [
  "check",
  "history-compare-config",
  "history-diff",
  "history-re-export",
  "history-restore",
  "push",
  "service-detail",
  "sync",
  "validate",
] as const;

/** An operation the app asks for that has no handler yet. */
export type PendingAppOperation = (typeof PENDING_APP_OPERATIONS)[number];

