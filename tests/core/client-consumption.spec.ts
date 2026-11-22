import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { IClientConsumptionOptions } from "../../packages/contracts/interfaces/core/client-consumption.interface.js";
import { scanClientConsumption } from "../../packages/core/discovery/client-consumption.service.js";
import { ProjectIndex } from "../../packages/core/index/project-index.service.js";

async function scan(sources: Record<string, string>, options?: IClientConsumptionOptions) {
  const root = await mkdtemp(join(tmpdir(), "tanit-clients-"));
  try {
    await Promise.all(Object.entries(sources).map(([name, source]) => writeFile(join(root, name), source)));
    const index = await ProjectIndex.open(root);
    try {
      return await scanClientConsumption(index, options);
    } finally {
      index.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("client consumption", () => {
  it("recognizes JavaScript, TypeScript, JSX and TSX with static call evidence", async () => {
    const result = await scan({
      "main.js": 'fetch("https://api.example.test:8443/v1/items?q=2#part");',
      "main.jsx": 'export const Page = () => <div onClick={() => fetch("/v1/items")} />;',
      "main.ts": [
        'import transport from "axios";',
        'const ROOT = "/v1" as const;',
        'transport.post(`${ROOT}/items`, payload);',
        'transport.request({url: ROOT + "/items", method: "patch"});',
        'transport({url: "/v1/items", method: "head"});',
      ].join("\n"),
      "main.tsx": [
        'import { client as http } from "./client";',
        'const Page = () => <div onClick={() => http.get("/v1/items")} />;',
      ].join("\n"),
    }, { aliases: [{ receiver: "http", source: "./client" }] });

    expect(result.diagnostics).toEqual([]);
    expect(result.usages.map(({ method, path }) => [method, path])).toEqual([
      ["GET", "/v1/items"], ["GET", "/v1/items"], ["POST", "/v1/items"],
      ["PATCH", "/v1/items"], ["HEAD", "/v1/items"], ["GET", "/v1/items"],
    ]);
    expect(result.usages[0]).toMatchObject({
      host: "api.example.test:8443",
      location: { file: "main.js", line: 1, column: 0, start: 0 },
      evidence: { recognizer: "fetch", callee: "fetch", staticUrl: "literal" },
      confidence: "high",
    });
    expect(result.usages[2]).toMatchObject({
      location: { file: "main.ts", line: 3, column: 0 },
      evidence: { recognizer: "axios", callee: "transport.post", staticUrl: "expression" },
      confidence: "medium",
    });
    expect(result.usages[5]?.correlation).toBeUndefined();
  });

  it("recognizes a CommonJS Axios import and rejects a shadowed require", async () => {
    const result = await scan({
      "main.cjs": [
        'const transport = require("axios");',
        'transport.get("/items");',
        'function invoke(require) {',
        '  const local = require("axios");',
        '  local.get("/items");',
        '}',
      ].join("\n"),
    });

    expect(result.usages.map(({ path, unresolvedReason }) => [path, unresolvedReason])).toEqual([
      ["/items", undefined],
      [undefined, "shadowed-client"],
    ]);
  });

  it("retains unknown inputs and lexically shadowed bindings", async () => {
    const result = await scan({
      "main.ts": [
        'import api from "axios";',
        'import { http } from "@other/client";',
        'const URL = "/known";',
        'const METHOD = "post";',
        'fetch(URL, { method: METHOD });',
        'function a(fetch: unknown) { fetch("/shadowed"); }',
        'function b(URL: string) { fetch(URL); }',
        'function c(api: unknown) { api.get("/shadowed"); }',
        'fetch("/v1/" + runtime());',
        'fetch("/known", { ...init });',
        'fetch("/known", { method: runtime() });',
        'api.request({ ...options });',
        'api.get("/known", config);',
        'http.get("/known");',
        'generated.get("/known");',
        'loadItems("/known");',
        'fetch("/still-global");',
      ].join("\n"),
    }, { aliases: [{ receiver: "http" }, { receiver: "generated", kind: "unsupported" }, { receiver: "loadItems" }] });

    expect(result.usages.map((usage) => usage.unresolvedReason)).toEqual([
      undefined, "shadowed-client", "dynamic-url", "shadowed-client", "dynamic-url",
      "unknown-options", "dynamic-method", "unknown-options", "unknown-options",
      "unresolved-alias", "unsupported-call", "unsupported-call", undefined,
    ]);
    expect(result.usages[0]).toMatchObject({ method: "POST", path: "/known" });
    expect(result.usages[5]).toMatchObject({ path: "/known", confidence: "low" });
    expect(result.usages[7]?.path).toBeUndefined();
    expect(result.usages[8]?.path).toBeUndefined();
  });

  it("requires a known base for path-relative calls and retains uncertain Axios overloads", async () => {
    const result = await scan({
      "calls.js": [
        'import axios from "axios";',
        'fetch("items");',
        'axios.request(config);',
        'axios.request("/items", { url: "/other", method: "post" });',
        'axios.request("/items", { method: "post" });',
        'axios.request({ url: "/items", method: computeMethod() });',
      ].join("\n"),
    }, { backend: [{ method: "POST", uri: "/items" }] });

    expect(result.usages.map(({ method, path, unresolvedReason, correlation }) =>
      [method, path, unresolvedReason, correlation?.status])).toEqual([
      ["GET", undefined, "relative-url", "unknown"],
      [undefined, undefined, "unknown-options", "unknown"],
      [undefined, undefined, "unknown-options", "unknown"],
      ["POST", "/items", undefined, "matched"],
      [undefined, "/items", "dynamic-method", "unknown"],
    ]);
  });

  it("filters known different hosts while preserving hostless ambiguity", async () => {
    const primary = { method: "GET", uri: "https://API.example.test:443/items", id: "primary" } as const;
    const secondary = { method: "GET", uri: "https://other.example.test/items", id: "secondary" } as const;
    const result = await scan({
      "calls.js": [
        'fetch("https://api.example.test/items");',
        'fetch("/items");',
        'fetch("https://unrelated.example.test/items");',
      ].join("\n"),
    }, { backend: [primary, secondary] });

    expect(result.usages.map((usage) => usage.correlation)).toEqual([
      { status: "matched", candidates: [primary] },
      { status: "ambiguous", candidates: [primary, secondary] },
      { status: "missing", candidates: [] },
    ]);
  });

  it("correlates only known method and path within the supplied catalog", async () => {
    const matched = { method: "GET", uri: "/items", id: "items.read" } as const;
    const duplicateA = { method: "DELETE", uri: "/items", id: "items.delete.a" } as const;
    const duplicateB = { method: "DELETE", uri: "/items", id: "items.delete.b" } as const;
    const unused = { method: "PATCH", uri: "/items", id: "items.update" } as const;
    const result = await scan({
      "calls.ts": [
        'fetch("/items?a=b");',
        'fetch("/items", { method: "DELETE" });',
        'fetch("/items", { method: "POST" });',
        'fetch(items);',
        'fetch("/items", options);',
      ].join("\n"),
      "settings.component.html": '<button (click)="client.get(\'/items\')">Get</button>',
      "view.vue": '<script setup>fetch("/items")</script>',
      "invalid.ts": 'const =',
    }, { backend: [matched, duplicateA, duplicateB, unused] });

    expect(result.usages.map((usage) => usage.correlation)).toEqual([
      { status: "matched", candidates: [matched] },
      { status: "ambiguous", candidates: [duplicateA, duplicateB] },
      { status: "missing", candidates: [] },
      { status: "unknown", candidates: [] },
      { status: "unknown", candidates: [] },
    ]);
    expect(result.counts).toEqual({ resolved: 3, unresolved: 2, matched: 1, missing: 1, ambiguous: 1 });
    expect(result.operationsWithoutConfirmedConsumer).toEqual([duplicateA, duplicateB, unused]);
    expect(result.diagnostics).toEqual([
      { file: "invalid.ts", reason: "parse-failed" },
      { file: "settings.component.html", reason: "unsupported-template" },
      { file: "view.vue", reason: "unsupported-template" },
    ]);
  });
});
