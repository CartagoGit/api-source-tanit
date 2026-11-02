/**
 * The parity gate, tested against the gate.
 *
 * `scripts/gates/lint-cli-app-parity.script.ts` is the thing that keeps
 * the CLI and the app from drifting apart, so it deserves to be
 * checked like any other piece of logic: a gate that stops detecting
 * is worse than no gate, because it still says "all good".
 *
 * The gate reads the real contract and the real app, and these tests
 * drive **its** function — not a copy of it — so a scan that stopped
 * seeing anything would fail here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { appOperations } from "../../scripts/gates/lint-cli-app-parity.script";
import { HANDLER_NAMES } from "../../packages/contracts/constants/core/application-api.constant";
import {
  CLI_APP_PARITY,
  PENDING_APP_OPERATIONS,
} from "../../packages/contracts/constants/core/cli-app-parity.constant";
import { COMMANDS } from "../../packages/cli/commands.constant";

describe("the parity gate", () => {
  it("sees the operations the app asks for", async () => {
    const operations = await appOperations();
    expect(operations.size).toBeGreaterThan(0);
    expect(operations.has("list-services")).toBe(true);
  });

  it("asks for nothing that the registry does not have", async () => {
    const handlers = new Set<string>(HANDLER_NAMES);
    const operations = await appOperations();
    for (const [operation, asks] of operations) {
      if (!asks.some((ask) => ask.kind === "request")) continue;
      // Asked for as a served operation, it has to exist — that is
      // the whole point of the typed contract.
      expect(handlers.has(operation)).toBe(true);
    }
  });

  it("asks for every pending operation as pending, and no others", async () => {
    const handlers = new Set<string>(HANDLER_NAMES);
    const pending = new Set<string>(PENDING_APP_OPERATIONS);
    const operations = await appOperations();
    for (const [operation, asks] of operations) {
      if (handlers.has(operation)) continue;
      // Asked for as served and with no handler: a call that would
      // answer UNKNOWN_HANDLER.
      expect(pending.has(operation)).toBe(true);
      // And it is asked for AS pending — that is what the pending
      // backlog means, and it is what the gate counts.
      expect(asks.some((ask) => ask.kind === "pending")).toBe(true);
    }
  });

  it("keeps the pending backlog clear of the registered handlers", () => {
    const handlers = new Set<string>(HANDLER_NAMES);
    for (const operation of PENDING_APP_OPERATIONS) {
      expect(handlers.has(operation)).toBe(false);
    }
  });

  it("has a capability for every command the CLI dispatches", () => {
    const mapped = new Set(CLI_APP_PARITY.flatMap((entry) => entry.cli));
    for (const command of Object.keys(COMMANDS)) {
      expect(mapped.has(command)).toBe(true);
    }
  });

  it("names only commands the CLI dispatches", () => {
    for (const entry of CLI_APP_PARITY) {
      for (const command of entry.cli) {
        expect(Object.keys(COMMANDS)).toContain(command);
      }
    }
  });

  it("never names a handler that does not exist", () => {
    const handlers = new Set<string>(HANDLER_NAMES);
    for (const entry of CLI_APP_PARITY) {
      for (const handler of entry.api) {
        expect(handlers.has(handler)).toBe(true);
      }
    }
  });

  it("says which capabilities the app cannot reach yet", () => {
    const gaps = CLI_APP_PARITY.filter((entry) => entry.status === "gap");
    // The gaps are the work: they are written down, not hidden.
    for (const gap of gaps) {
      expect(gap.note.length).toBeGreaterThan(0);
    }
  });

  it("lives where the gate says it does", () => {
    const gate = readFileSync(
      "scripts/gates/lint-cli-app-parity.script.ts",
      "utf8",
    );
    expect(gate).toContain("CLI_APP_PARITY");
    expect(gate).toContain("PENDING_APP_OPERATIONS");
  });
});
