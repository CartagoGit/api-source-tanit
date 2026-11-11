#!/usr/bin/env bun
/**
 * `bun run lint:cli-app-parity` — the CLI and the desktop app cannot
 * drift apart without the build saying so.
 *
 * ## Why this gate exists
 *
 * The product has two faces: the **CLI** (`apisrc <command>`) and the
 * **desktop app** (Angular, in `packages/app`). The CLI is the
 * reference for what the tool can do; the app is the same tool with a
 * face instead of commands. `docs/CLI.md` says exactly that, and
 * carries a "GUI action | CLI command" table.
 *
 * Nobody checked, and the drift was total:
 *
 *   · The app asked the bridge for **twelve** operations; the
 *     Application API had **three**. The other nine answered
 *     `UNKNOWN_HANDLER` — three quarters of the calls could not work,
 *     and no test, gate or type said so.
 *   · The contract the app used declared thirteen operations in
 *     camelCase that matched nothing at all: not the CLI, not the
 *     registry, not even the strings the app itself sent.
 *   · The app's endpoint list was a fixture of five thousand invented
 *     endpoints, and none of its eleven features was mounted.
 *
 * The consequence is worse than a bug: the two faces look finished and
 * are not. That is exactly what this gate refuses to let happen.
 *
 * ## What it checks
 *
 *   1. **Every CLI command is in the map.** A new command with no
 *      counterpart in the app is invisible drift; the gate names it.
 *   2. **Every handler the map names exists.** The map cannot claim a
 *      capability the API does not have.
 *   3. **Every operation the app asks for exists** — or is declared in
 *      `PENDING_APP_OPERATIONS`. An undeclared one would answer
 *      `UNKNOWN_HANDLER` at runtime.
 *   4. **A pending operation that already exists fails the gate.**
 *      The backlog entry has expired: the app has to use the handler
 *      and take it off the list.
 *   5. **A pending operation the app no longer asks for fails the
 *      gate.** The list has to shrink with the app.
 *
 * Rules 4 and 5 are what make the backlog a list of work that empties
 * itself instead of a comment that rots.
 *
 * ## How the app's operations are found
 *
 * By reading them out of the app's own source: the literals passed to
 * `request("…")`. They are gathered from `packages/app/src`, which is
 * where the clients live. This is textual on purpose — the alternative
 * is a registry the app has to remember to update, and a registry that
 * has to be remembered is a registry that lies.
 *
 * Usage:
 *   bun run lint:cli-app-parity
 */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { collectFiles } from "../helpers/walk.helper.js";
import { HANDLER_NAMES } from "../../packages/contracts/constants/core/application-api.constant.js";
import {
  CLI_APP_PARITY,
  PENDING_APP_OPERATIONS,
} from "../../packages/contracts/constants/core/cli-app-parity.constant.js";
import { COMMANDS } from "../../packages/cli/commands.constant.js";

/** Where the app's clients live. */
const APP_SRC = fromRoot("packages", "app", "src");

/**
 * The literal operation names the app asks the bridge for.
 *
 * Two calls, and the difference between them is the whole point:
 *
 *   · `request("…")` — the operation has a handler. If it does not,
 *     the call would answer `UNKNOWN_HANDLER` at runtime.
 *   · `requestPending("…")` — the app knows the operation has **no**
 *     handler yet and says so. Those are the backlog, and they are
 *     listed in `PENDING_APP_OPERATIONS`.
 *
 * The pattern is deliberately narrow in the other direction: a call
 * with a variable, or a method **definition** (which never has a
 * string literal after the parenthesis), is not an operation name and
 * must not be mistaken for one.
 */
const REQUEST_CALL = /request\(\s*"([a-z][a-z0-9-]*)"/g;
const PENDING_CALL = /requestPending\(\s*"([a-z][a-z0-9-]*)"/g;

interface IFinding {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** How the app asks for an operation. */
type AskKind = "request" | "pending";

function relativeToRepo(file: string): string {
  return relative(REPO_ROOT, file);
}

/** The commands the CLI really dispatches, from the record itself. */
function cliCommandNames(): Set<string> {
  return new Set(Object.keys(COMMANDS));
}

/**
 * The operations the app asks for, and where each one was asked.
 *
 * Exported so the gate's own test reads the app through **this**
 * function. A test that re-implemented the scan would pass even when
 * the scan had stopped seeing anything.
 */
export async function appOperations(): Promise<Map<string, { kind: AskKind; where: string }[]>> {
  const found = new Map<string, { kind: AskKind; where: string }[]>();
  const files = await collectFiles(APP_SRC, [".ts"]);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      const where = `${relativeToRepo(file)}:${index + 1}`;
      const record = (kind: AskKind, operation: string): void => {
        const seen = found.get(operation);
        if (seen === undefined) found.set(operation, [{ kind, where }]);
        else seen.push({ kind, where });
      };
      // `matchAll` and not `exec` in a loop: the pattern lives at
      // module level, and a global regex carries its `lastIndex` in
      // the whole process. Two scans at once would step on each
      // other's position — and one of them would repeat or skip
      // matches. `matchAll` does not touch it.
      for (const match of line.matchAll(REQUEST_CALL)) {
        record("request", match[1] ?? "");
      }
      for (const match of line.matchAll(PENDING_CALL)) {
        record("pending", match[1] ?? "");
      }
    });
  }
  return found;
}

async function main(): Promise<number> {
  const findings: IFinding[] = [];
  const commands = cliCommandNames();
  const handlers = new Set<string>(HANDLER_NAMES);
  const pending = new Set<string>(PENDING_APP_OPERATIONS);

  // 1. Every command the CLI dispatches has to be in the map.
  const mappedCommands = new Set<string>();
  for (const entry of CLI_APP_PARITY) {
    for (const command of entry.cli) {
      mappedCommands.add(command);
      if (!commands.has(command)) {
        findings.push({
          file: "packages/contracts/constants/core/cli-app-parity.constant.ts",
          line: 0,
          message:
            `la capacidad "${entry.capability}" nombra el comando "${command}", ` +
            `que el CLI no despacha`,
        });
      }
    }
  }
  for (const command of [...commands].sort()) {
    if (!mappedCommands.has(command)) {
      findings.push({
        file: "packages/cli/commands.constant.ts",
        line: 0,
        message:
          `el CLI despacha "${command}" y el mapa de paridad no lo nombra: ` +
          `la app no tiene forma de llegar a esa capacidad`,
      });
    }
  }

  // 2. Every handler the map names exists in the registry.
  const mappedHandlers = new Set<string>();
  for (const entry of CLI_APP_PARITY) {
    for (const handler of entry.api) {
      mappedHandlers.add(handler);
      if (!handlers.has(handler)) {
        findings.push({
          file: "packages/contracts/constants/core/cli-app-parity.constant.ts",
          line: 0,
          message:
            `la capacidad "${entry.capability}" nombra el handler "${handler}", ` +
            `que la Application API no registra`,
        });
      }
    }
  }

  // 3-5. The app's own operations, against the registry and the
  //      declared backlog.
  const operations = await appOperations();
  for (const [operation, asks] of [...operations.entries()].sort()) {
    const where = asks[0]?.where ?? "packages/app";
    const kinds = new Set(asks.map((ask) => ask.kind));
    const asPending = kinds.has("pending");
    const asServed = kinds.has("request");

    if (handlers.has(operation)) {
      // 4. It exists — so it must not still be declared pending.
      if (pending.has(operation)) {
        findings.push({
          file: "packages/contracts/constants/core/cli-app-parity.constant.ts",
          line: 0,
          message:
            `"${operation}" ya existe en la Application API (${where}): ` +
            `la app debe usarlo y quitarlo de PENDING_APP_OPERATIONS`,
        });
      }
      continue;
    }

    // It does not exist. Asking for it as served would answer
    // UNKNOWN_HANDLER without anybody noticing.
    if (asServed) {
      findings.push({
        file: where,
        line: 0,
        message:
          `la app pide "${operation}" y la Application API no lo registra: ` +
          `esa llamada respondería UNKNOWN_HANDLER. Decláralo en ` +
          `PENDING_APP_OPERATIONS y pídelo con requestPending(), o ` +
          `implementa el handler`,
      });
    }
    // Asking for it as pending is honest — but it has to be declared.
    if (asPending && !pending.has(operation)) {
      findings.push({
        file: where,
        line: 0,
        message:
          `la app pide "${operation}" como pendiente pero no está en ` +
          `PENDING_APP_OPERATIONS: el backlog tiene que decir la verdad`,
      });
    }
  }

  // 5. The other direction: a pending operation nobody asks for.
  for (const operation of [...pending].sort()) {
    const asks = operations.get(operation);
    if (asks === undefined) {
      findings.push({
        file: "packages/contracts/constants/core/cli-app-parity.constant.ts",
        line: 0,
        message:
          `"${operation}" está en PENDING_APP_OPERATIONS pero la app ya no lo ` +
          `pide: la lista debe encogerse`,
      });
      continue;
    }
    if (!asks.some((ask) => ask.kind === "pending")) {
      findings.push({
        file: asks[0]?.where ?? "packages/app",
        line: 0,
        message:
          `"${operation}" está en PENDING_APP_OPERATIONS pero la app lo pide ` +
          `como una operación servida: o tiene handler, o la petición es ` +
          `una llamada rota`,
      });
    }
  }

  if (findings.length > 0) {
    console.error("lint:cli-app-parity — el CLI y la app se han separado:\n");
    for (const finding of findings) {
      const where = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
      console.error(`  ✗ ${where}\n      ${finding.message}`);
    }
    console.error(
      `\nlint:cli-app-parity — ${findings.length} problema(s). El mapa de paridad vive en ` +
        `packages/contracts/constants/core/cli-app-parity.constant.ts`,
    );
    return 1;
  }

  const gaps = CLI_APP_PARITY.filter((entry) => entry.status === "gap");
  const partial = CLI_APP_PARITY.filter((entry) => entry.status === "partial");
  console.log(
    `lint:cli-app-parity — ${commands.size} comando(s) del CLI, ` +
      `${handlers.size} handler(s) en la API, ${operations.size} operación(es) pedidas por la app.`,
  );
  console.log(
    `  Paridad: ${CLI_APP_PARITY.length - gaps.length - partial.length} completa(s), ` +
      `${partial.length} parcial(es), ${gaps.length} con hueco(s).`,
  );
  for (const gap of gaps) {
    console.log(`  · hueco — ${gap.capability}: ${gap.note}`);
  }
  if (pending.size > 0) {
    console.log(`  · ${pending.size} operación(es) pendiente(s) de handler: ${[...pending].sort().join(", ")}`);
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
