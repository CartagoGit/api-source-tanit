import { describe, expect, it } from "vitest";

import type {
  IClientBackendOperation,
  IClientUsage,
} from "../../packages/contracts/interfaces/core/client-consumption.interface.js";
import { correlateClientUsageLinks } from "../../packages/core/discovery/client-correlation.helper.js";

function usage(path: string, host?: string): IClientUsage {
  return {
    method: "GET",
    path,
    ...(host === undefined ? {} : { host }),
    location: { file: "client.ts", line: 1, column: 0 },
    evidence: { recognizer: "fetch", callee: "fetch", staticUrl: "literal" },
    confidence: "high",
  };
}

const items: IClientBackendOperation = { method: "GET", uri: "/v1/items" };
const orders: IClientBackendOperation = { method: "GET", uri: "/v1/orders" };

describe("selected client backend links", () => {
  it("consumes only the operation matched by a call across selected services", () => {
    const call = { ...usage("/v1/items"), method: "get" };
    const itemOperation = { ...items, uri: "/v1/items?stored=yes#part" };
    const result = correlateClientUsageLinks([call], [
      { id: "catalog", operations: [itemOperation] },
      { id: "orders", operations: [orders] },
    ]);
    expect(result).toEqual({
      calls: [{
        usage: call, status: "matched", backendId: "catalog",
        candidates: [{ backendId: "catalog", operation: itemOperation }],
      }],
      backends: [
        { id: "catalog", operationsWithoutConfirmedConsumer: [] },
        { id: "orders", operationsWithoutConfirmedConsumer: [orders] },
      ],
    });
  });

  it("keeps duplicate operations within and across services ambiguous in catalog order", () => {
    const duplicate = { ...items, id: "alternate" };
    const catalog = { id: "catalog", operations: [items, duplicate] };
    const call = usage("/v1/items");
    const sameService = correlateClientUsageLinks([call], [catalog]);
    expect(sameService.calls).toEqual([{
      usage: call, status: "ambiguous", backendId: "catalog",
      candidates: [
        { backendId: "catalog", operation: items },
        { backendId: "catalog", operation: duplicate },
      ],
    }]);
    const acrossServices = correlateClientUsageLinks([call], [
      catalog,
      { id: "other", operations: [items] },
    ]);
    expect(acrossServices.calls).toEqual([{
      usage: call, status: "ambiguous",
      candidates: [
        { backendId: "catalog", operation: items },
        { backendId: "catalog", operation: duplicate },
        { backendId: "other", operation: items },
      ],
    }]);
    expect(acrossServices.backends).toEqual([
      { id: "catalog", operationsWithoutConfirmedConsumer: [items, duplicate] },
      { id: "other", operationsWithoutConfirmedConsumer: [items] },
    ]);
  });

  it("prefers a matching link host and honors known operation hosts and methods", () => {
    const host = "catalog.example:8443";
    const rightHost = { ...items, uri: `https://${host}/v1/items` };
    const wrongHost = { ...items, uri: "https://other.example/v1/items" };
    const get = usage("/v1/items", host);
    const post: IClientUsage = { ...get, method: "POST" };
    const result = correlateClientUsageLinks([get, post], [
      { id: "unqualified", operations: [items, { ...items, method: "POST" }] },
      { id: "catalog", host, operations: [wrongHost, rightHost] },
      { id: "other", host: "other.example", operations: [wrongHost] },
    ]);
    expect(result.calls).toEqual([
      {
        usage: get, status: "matched", backendId: "catalog",
        candidates: [{ backendId: "catalog", operation: rightHost }],
      },
      { usage: post, status: "missing", backendId: "catalog", candidates: [] },
    ]);
    expect(result.backends[1]?.operationsWithoutConfirmedConsumer).toEqual([wrongHost]);
    expect(result.backends[2]?.operationsWithoutConfirmedConsumer).toEqual([wrongHost]);
  });

  it("uses only links without a declared host when a known host has no exact link", () => {
    const call = usage("/v1/items", "other.example");
    const qualified = { id: "catalog", host: "catalog.example", operations: [items] };
    expect(correlateClientUsageLinks([call], [qualified]).calls).toEqual([
      { usage: call, status: "unknown", candidates: [] },
    ]);
    const result = correlateClientUsageLinks([call], [qualified, { id: "fallback", operations: [items] }]);
    expect(result.calls).toEqual([{
      usage: call, status: "matched", backendId: "fallback",
      candidates: [{ backendId: "fallback", operation: items }],
    }]);
    expect(result.backends[0]?.operationsWithoutConfirmedConsumer).toEqual([items]);
  });

  it("keeps unresolved and unattributable calls unknown", () => {
    const noMatch = usage("/no-match");
    const unresolved: IClientUsage = { ...usage("/v1/items"), unresolvedReason: "dynamic-method" };
    const catalog = { id: "catalog", operations: [items] };
    const result = correlateClientUsageLinks([noMatch, unresolved], [
      catalog,
      { id: "orders", operations: [orders] },
    ]);
    expect(result.calls).toEqual([
      { usage: noMatch, status: "unknown", candidates: [] },
      { usage: unresolved, status: "unknown", candidates: [] },
    ]);
    expect(correlateClientUsageLinks([unresolved], [catalog]).calls).toEqual([
      { usage: unresolved, status: "unknown", candidates: [] },
    ]);
  });

  it("handles empty comparisons and distinguishes no links from an empty catalog", () => {
    const call = usage("/v1/items");
    expect(correlateClientUsageLinks([], [])).toEqual({ calls: [], backends: [] });
    expect(correlateClientUsageLinks([call], []).calls).toEqual([
      { usage: call, status: "unknown", candidates: [] },
    ]);
    expect(correlateClientUsageLinks([call], [{ id: "empty", operations: [] }])).toEqual({
      calls: [{ usage: call, status: "missing", backendId: "empty", candidates: [] }],
      backends: [{ id: "empty", operationsWithoutConfirmedConsumer: [] }],
    });
  });

  it("rejects blank and repeated selected backend IDs", () => {
    const backend = { id: "catalog", operations: [items] };
    expect(() => correlateClientUsageLinks([], [{ id: " ", operations: [] }])).toThrow(/blank/u);
    expect(() => correlateClientUsageLinks([], [backend, { ...backend }])).toThrow(/Duplicate/u);
  });
});
