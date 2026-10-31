/**
 * The registry of CLI commands — the **source of truth** of the CLI's
 * surface.
 *
 * It is its own module, separate from the dispatcher, for two reasons:
 *
 *   · The gate that checks the CLI and the app go hand in hand
 *     (`scripts/gates/lint-cli-app-parity.script.ts`) reads it to know
 *     which commands **really** exist, instead of comparing against a
 *     parallel list that could drift without anybody noticing.
 *   · It is a **graph of composition**, not a contract: each entry
 *     carries a dynamic `import()` of the command it runs.
 *
 * ## Why the dynamic imports are literal
 *
 * `bun build --compile` only includes a module in the binary if it can
 * see the `import()` as a literal. An `import(variable)` would leave the
 * command out of the executable — and the binary would fail with
 * "Module not found" on the first command the user typed.
 *
 * ## Why it does not live in `packages/contracts`
 *
 * A contract describes a shape that everyone agrees on. This describes
 * *where the code is*, and moving it to contracts would invert the
 * dependency (contracts → cli) and drag the implementation into the
 * layer that promises to have none. The shape of a command
 * (`ICommand`) **is** a contract, and that part lives in
 * `packages/contracts/interfaces/cli/command.interface.ts`.
 */
import type { ICommand } from "../contracts/interfaces/cli/command.interface.js";

/** Every command the CLI dispatches, by name. */
export const COMMANDS: Record<string, ICommand> = {
  generate: {
    summary: "Generate the Postman v2.1.0 collection and its environments",
    load: () => import("./commands/generate.script.js"),
  },
  ui: {
    summary: "Open the graphical interface in your browser (no flags needed)",
    load: () => import("./commands/ui.script.js"),
  },
  check: {
    summary: "Check that an already generated collection is still in sync",
    load: () => import("./commands/diff.script.js"),
  },
  sync: {
    summary: "Generate the collection using the same pipeline as the GUI",
    load: () => import("./commands/sync.script.js"),
  },
  list: {
    summary: "List the detected endpoints, grouped by folder",
    load: () => import("./commands/list-endpoints.script.js"),
  },
  stats: {
    summary: "Endpoint counts per HTTP method and folder",
    load: () => import("./commands/stats.script.js"),
  },
  scan: {
    summary: "Scan the project and optionally persist a shadow state snapshot",
    load: () => import("./commands/scan.script.js"),
  },
  validate: {
    summary: "Validate a generated collection against the Postman v2.1.0 schema",
    load: () => import("./commands/validate-json.script.js"),
  },
  push: {
    summary: "Upload the collection straight to your Postman workspace",
    load: () => import("./commands/push.script.js"),
  },
  watch: {
    summary: "Regenerate the collection whenever a route file changes",
    load: () => import("./commands/watch.script.js"),
  },
  history: {
    summary: "List past generations and inspections, most recent first",
    load: () => import("./commands/history.script.js"),
  },
  // f00016 S4 — Application API as a long-lived service. Same
  // handler registry as the HTTP/UI carrier; the carrier flag
  // (--stdio / --http) lives inside the command. See
  // `serve.script.ts` for the bridge implementation.
  serve: {
    summary:
      "Run the Application API as a long-lived service (--stdio sidecar or --http browser bridge)",
    load: () => import("./commands/serve.script.js"),
  },
};
