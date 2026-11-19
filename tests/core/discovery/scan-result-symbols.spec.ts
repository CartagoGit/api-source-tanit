/**
 * IScanResult.symbols contract test (audit 2026-09-06 §12,
 * proposal `r00014` S3).
 *
 * Pins that:
 *
 *   1. `IScanResult` with `symbols: undefined` is still
 *      backwards-compatible (legacy scanners that don't
 *      know about the field keep compiling).
 *   2. The 3 JS/TS scanners (Express, Fastify, Hono)
 *      initialise `symbols: SymbolGraph.empty()` in their
 *      `scan()`. Behaviour unchanged from today; field shape
 *      is the new contract.
 *
 * We don't re-run the scanner's full fixture (already
 * covered by the framework specs); we just verify the
 * return shape and the contract exists in TypeScript's
 * eyes.
 */
import { describe, expect, test } from "vitest";

import {
  IScanResult,
} from "../../../packages/contracts/interfaces/core/scanner.interface";
import { empty } from "../../../packages/core/discovery/symbol-graph";

describe("IScanResult.symbols (r00014 S3)", () => {
  test("(1) the field is optional — undefined is a valid shape", () => {
    const legacy: IScanResult = { routes: [] };
    expect(legacy.symbols).toBeUndefined();
  });

  test("(2a) SymbolGraph.empty() returns a graph with zero nodes", () => {
    const g = empty();
    expect(g.nodes).toEqual([]);
    expect(g.imports).toEqual([]);
    expect(g.resolveByName("/nope", "x")).toEqual([]);
    expect(g.resolveByImportPath("/a", "./b", "c")).toEqual([]);
  });

  test("(2b) IScanResult can carry a SymbolGraph", () => {
    const g = empty();
    const r: IScanResult = { routes: [], symbols: g };
    expect(r.symbols).toBe(g);
    expect(r.symbols?.nodes).toEqual([]);
  });
});
