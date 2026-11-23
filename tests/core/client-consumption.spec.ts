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

  it("recognizes Angular HttpClient instance members from aliased package imports", async () => {
    const result = await scan({
      "items.component.ts": [
        'import { HttpClient as Client } from "@angular/common/http";',
        'import { Component, inject as resolve } from "@angular/core";',
        '@Component({ selector: "app-items", templateUrl: "./items.component.html" })',
        'class ItemsComponent {',
        '  constructor(private readonly api: Client) {}',
        '  private readonly transport = resolve(Client);',
        '  load(): unknown {',
        '    this.api.get<{ name: string }>("/items");',
        '    return () => this.transport.post("/items", { name: "sample" });',
        '  }',
        '  reload(url: string): unknown { return this.api.get(url); }',
        '}',
      ].join("\n"),
      "items.component.html": '<button (click)="api.get(\'/template\')">Load</button>',
    });

    expect(result.usages).toMatchObject([
      {
        method: "GET", path: "/items",
        location: { file: "items.component.ts", line: 8 },
        evidence: { recognizer: "angular-http-client", callee: "this.api.get", staticUrl: "literal" },
      },
      {
        method: "POST", path: "/items",
        location: { file: "items.component.ts", line: 9 },
        evidence: { recognizer: "angular-http-client", callee: "this.transport.post", staticUrl: "literal" },
      },
      {
        method: "GET", unresolvedReason: "dynamic-url",
        location: { file: "items.component.ts", line: 11 },
        evidence: { recognizer: "angular-http-client", callee: "this.api.get" },
      },
    ]);
    expect(result.usages[2]?.path).toBeUndefined();
    expect(result.diagnostics).toEqual([{ file: "items.component.html", reason: "unsupported-template" }]);
  });

  it("keeps Angular HttpClient evidence bound to the declared instance and real package names", async () => {
    const result = await scan({
      "classes.ts": [
        'import { HttpClient as Client } from "@angular/common/http";',
        'import { HttpClient as Lookalike } from "./mock-http";',
        'import { inject as mockInject } from "./mock-inject";',
        'class Genuine {',
        '  constructor(private readonly http: Client) {}',
        '  static check() { this.http.get("/static"); }',
        '  check() {',
        '    function rebound() { return this.http.get("/rebound"); }',
        '    return () => this.http.get("/instance");',
        '  }',
        '}',
        'class Other {',
        '  constructor(private readonly http: Lookalike) {}',
        '  private readonly injected = mockInject(Client);',
        '  check() { this.http.get("/lookalike"); this.injected.get("/fake-inject"); }',
        '}',
        'class Mock {',
        '  readonly http = { get(_url: string) {} };',
        '  check() { this.http.get("/mock"); }',
        '}',
        'class Shadowed<Client> {',
        '  constructor(private readonly http: Client) {}',
        '  check() { this.http.get("/shadowed-type"); }',
        '}',
      ].join("\n"),
    });

    expect(result.usages).toMatchObject([{
      method: "GET", path: "/instance",
      location: { file: "classes.ts", line: 9 },
      evidence: { recognizer: "angular-http-client", callee: "this.http.get" },
    }]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reads the method and URL independently for Angular HttpClient request", async () => {
    const result = await scan({
      "requests.ts": [
        'import { HttpClient } from "@angular/common/http";',
        'class Requests {',
        '  constructor(private readonly http: HttpClient) {}',
        '  send(method: string) {',
        '    this.http.request("PATCH", "/items");',
        '    this.http.request(method, "/items");',
        '  }',
        '}',
      ].join("\n"),
    });

    expect(result.usages).toMatchObject([
      {
        method: "PATCH", path: "/items",
        location: { file: "requests.ts", line: 5 },
        evidence: { recognizer: "angular-http-client", callee: "this.http.request", staticUrl: "literal" },
      },
      {
        unresolvedReason: "dynamic-method",
        location: { file: "requests.ts", line: 6 },
        evidence: { recognizer: "angular-http-client", callee: "this.http.request" },
      },
    ]);
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

  it("scans one Vue script or setup block with original component locations", async () => {
    const classicCall = 'fetch("/classic")';
    const classicSource = [
      '<!-- <script>fetch("/comment")</script> -->',
      `<template><button @click="fetch('/template')">Load</button></template>`,
      `<script>  ${classicCall};</script>`,
    ].join("\r\n");
    const setupCall = 'fetch(path)';
    const setupSource = [
      '<script setup lang="ts">',
      'const path: string = "/setup";',
      `  ${setupCall};`,
      '</script>',
    ].join("\r\n");

    const result = await scan({ "classic.vue": classicSource, "setup.vue": setupSource }, {
      backend: [{ method: "GET", uri: "/setup" }],
    });
    expect(result.usages).toMatchObject([
      {
        method: "GET", path: "/classic", correlation: { status: "missing" },
        location: {
          file: "classic.vue", line: 3, column: 10,
          start: classicSource.indexOf(classicCall),
          end: classicSource.indexOf(classicCall) + classicCall.length,
        },
      },
      {
        method: "GET", path: "/setup", correlation: { status: "matched" },
        location: {
          file: "setup.vue", line: 3, column: 2,
          start: setupSource.indexOf(setupCall),
          end: setupSource.indexOf(setupCall) + setupCall.length,
        },
      },
    ]);
    expect(result.diagnostics).toEqual([{ file: "classic.vue", reason: "unsupported-template" }]);
  });

  it.each(["jsx", "tsx"])("scans inline Vue scripts declared as %s", async (lang) => {
    const result = await scan({
      "view.vue": `<script lang="${lang}">export const View = () => <button onClick={() => fetch("/jsx")} />;</script>`,
    });
    expect(result.usages).toMatchObject([{ method: "GET", path: "/jsx" }]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ['<script>fetch("/classic")</script><script setup>fetch("/setup")</script>', "unsupported-script"],
    ['<script></script><script setup>fetch("/setup")</script>', "unsupported-script"],
    ['<script src="./external.ts">fetch("/inline")</script>', "unsupported-script"],
    ['<script setup src="./external.ts"></script>', "unsupported-script"],
    ['<script lang="coffee">fetch("/coffee")</script>', "unsupported-script"],
    ['<script lang>fetch("/invalid-lang")</script>', "unsupported-script"],
    ['<script>fetch("/first")</script><script>fetch("/second")</script>', "parse-failed"],
    ['<script setup>fetch("/first")</script><script setup>fetch("/second")</script>', "parse-failed"],
    ['<script>fetch("/unclosed")', "parse-failed"],
    ['<script>fetch("/invalid"); const =</script>', "parse-failed"],
    ['<script>const x = 1; const x = 2; fetch("/recovered");</script>', "parse-failed"],
  ])("rejects unsupported or malformed Vue script %s", async (source, reason) => {
    const result = await scan({ "view.vue": source });
    expect(result.usages).toEqual([]);
    expect(result.diagnostics).toEqual([{ file: "view.vue", reason }]);
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
      "view.vue": `<template><button @click="fetch('/items')">Get</button></template>`,
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
