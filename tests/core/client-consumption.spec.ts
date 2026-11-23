import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { IClientConsumptionOptions } from "../../packages/contracts/interfaces/core/client-consumption.interface.js";
import { scanClientConsumption } from "../../packages/core/discovery/client-consumption.service.js";
import { ProjectIndex } from "../../packages/core/index/project-index.service.js";

async function scan(
  sources: Record<string, string>,
  options?: IClientConsumptionOptions,
  rootless = false,
) {
  const root = await mkdtemp(join(tmpdir(), "tanit-clients-"));
  try {
    await Promise.all(Object.entries(sources).map(([name, source]) => writeFile(join(root, name), source)));
    const index = await ProjectIndex.open(root);
    try {
      const sourceIndex = rootless ? { files: index.files.bind(index), ensureAst: index.ensureAst.bind(index) } : index;
      return await scanClientConsumption(sourceIndex, options);
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

  it("scans explicit HttpClient calls in a uniquely owned Angular template at their original locations", async () => {
    const list = "this.http.get('/items')";
    const dynamic = "this.http.get(selectedUrl)";
    const html = [
      '<section>',
      `  <button (click)="${list}">List</button>`,
      `  <button (click)="${dynamic}">Select</button>`,
      '</section>',
    ].join("\r\n");

    const result = await scan({
      "items.component.ts": [
        'import { Component as View, inject as resolve } from "@angular/core";',
        'import { HttpClient as Client } from "@angular/common/http";',
        '@View({ templateUrl: "./items.component.html" })',
        'class Items { protected readonly http = resolve(Client); }',
      ].join("\n"),
      "items.component.html": html,
    });
    expect(result.usages).toMatchObject([
      {
        method: "GET", path: "/items",
        evidence: { recognizer: "angular-http-client", callee: "this.http.get", staticUrl: "literal" },
        location: {
          file: "items.component.html", line: 2, column: 19,
          start: html.indexOf(list), end: html.indexOf(list) + list.length,
        },
      },
      {
        method: "GET", unresolvedReason: "dynamic-url",
        evidence: { recognizer: "angular-http-client", callee: "this.http.get" },
        location: {
          file: "items.component.html", line: 3, column: 19,
          start: html.indexOf(dynamic), end: html.indexOf(dynamic) + dynamic.length,
        },
      },
    ]);
    expect(result.usages[1]?.path).toBeUndefined();
  });

  it("keeps unsupported Angular template calls and uncertain ownership out of the report", async () => {
    const result = await scan({
      "owners.ts": [
        'import { Component, inject } from "@angular/core";',
        'import { Component as FakeComponent } from "./component-mock";',
        'import { HttpClient } from "@angular/common/http";',
        '@Component({ templateUrl: "./implicit.component.html" })',
        'class Implicit { constructor(private readonly http: HttpClient) {} }',
        '@FakeComponent({ templateUrl: "./spoofed.component.html" })',
        'class Spoofed { private readonly http = inject(HttpClient); }',
        '@Component({ templateUrl: "./shared.component.html" })',
        'class SharedFirst { private readonly http = inject(HttpClient); }',
        '@Component({ templateUrl: "./shared.component.html" })',
        'class SharedSecond { private readonly http = inject(HttpClient); }',
        '@Component({ templateUrl: "./unproven.component.html" })',
        'class Unproven { readonly http = { get(_url: string) {} }; }',
      ].join("\n"),
      "implicit.component.html": [
        '<button (click)="http.get(\'/implicit\')">Implicit</button>',
        '<input #http><button (click)="http.get(\'/local\')">Local</button>',
      ].join("\n"),
      "spoofed.component.html": '<button (click)="this.http.get(\'/spoofed\')">Spoofed</button>',
      "shared.component.html": '<button (click)="this.http.get(\'/shared\')">Shared</button>',
      "unproven.component.html": '<button (click)="this.http.get(\'/unproven\')">Unproven</button>',
      "unowned.component.html": '<button (click)="this.http.get(\'/unowned\')">Unowned</button>',
    });

    expect(result.usages).toEqual([]);
    expect(result.diagnostics).toEqual([
      { file: "implicit.component.html", reason: "unsupported-template" },
      { file: "shared.component.html", reason: "unsupported-template" },
      { file: "spoofed.component.html", reason: "unsupported-template" },
      { file: "unowned.component.html", reason: "unsupported-template" },
      { file: "unproven.component.html", reason: "unsupported-template" },
    ]);
  });

  it("keeps unsupported Angular template encodings visible without inaccurate offsets", async () => {
    const result = await scan({
      "component.ts": [
        'import { Component, inject } from "@angular/core";',
        'import { HttpClient } from "@angular/common/http";',
        '@Component({ templateUrl: "app.html" })',
        'class Client { readonly http = inject(HttpClient); }',
      ].join("\n"),
      "app.html": '<button (click)="this.http.get(&apos;/items&apos;)">Load</button>',
    });

    expect(result.usages).toEqual([]);
    expect(result.diagnostics).toEqual([{ file: "app.html", reason: "unsupported-template" }]);
  });

  it("requires a physically contained Angular template before reading its calls", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "tanit-angular-scope-"));
    const root = join(scratch, "workspace");
    const shared = join(scratch, "external");
    try {
      await mkdir(root);
      await mkdir(shared);
      await writeFile(join(shared, "template.html"), `<button (click)="this.http.get('/items')">Load</button>`);
      await symlink(shared, join(root, "linked"), "junction");
      await writeFile(join(root, "component.ts"), [
        'import { Component, inject } from "@angular/core";',
        'import { HttpClient } from "@angular/common/http";',
        '@Component({ templateUrl: "./linked/template.html" })',
        'class Client { readonly http = inject(HttpClient); }',
      ].join("\n"));
      const index = await ProjectIndex.open(root);
      try {
        const result = await scanClientConsumption(index);
        expect(result.usages).toEqual([]);
        expect(result.diagnostics).toEqual([{ file: "linked/template.html", reason: "unsupported-template" }]);
      } finally {
        index.close();
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("preserves source analysis for index adapters without a project root", async () => {
    const result = await scan({
      "client.ts": [
        'import { Component, inject } from "@angular/core";',
        'import { HttpClient } from "@angular/common/http";',
        '@Component({ templateUrl: "./client.component.html" })',
        'class Client { readonly http = inject(HttpClient); load() { return this.http.get("/source"); } }',
      ].join("\n"),
      "client.component.html": `<button (click)="this.http.get('/template')">Load</button>`,
    }, undefined, true);

    expect(result.usages.map(({ path }) => path)).toEqual(["/source"]);
    expect(result.diagnostics).toEqual([{ file: "client.component.html", reason: "unsupported-template" }]);
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

  it("scans direct Vue setup event calls through verified imports at their original CRLF offsets", async () => {
    const setupCall = "api.get('/items')";
    const hoistedCall = "classic.get('/hoisted')";
    const aliasCall = "client.get('/configured')";
    const source = [
      "<template>",
      `  <button @click.stop="  ${setupCall}  ">Items</button>`,
      `  <button v-on:click="${hoistedCall}">Hoisted</button>`,
      `  <button @click="${aliasCall}">Configured</button>`,
      "</template>",
      '<script lang="ts">',
      'import classic from "axios";',
      "</script>",
      '<script setup lang="ts">',
      'import api from "axios";',
      'import client from "./transport";',
      "</script>",
    ].join("\r\n");

    const result = await scan({ "events.vue": source }, {
      aliases: [{ receiver: "client", source: "./transport" }],
      backend: [
        { method: "GET", uri: "/items" },
        { method: "GET", uri: "/hoisted" },
        { method: "GET", uri: "/configured" },
      ],
    });
    const location = (call: string, line: number) => ({
      file: "events.vue",
      line,
      column: source.split("\r\n")[line - 1]?.indexOf(call),
      start: source.indexOf(call),
      end: source.indexOf(call) + call.length,
    });

    expect(result.usages).toMatchObject([
      {
        method: "GET", path: "/items", correlation: { status: "matched" },
        evidence: { recognizer: "axios", callee: "api.get" },
        location: location(setupCall, 2),
      },
      {
        method: "GET", path: "/hoisted", correlation: { status: "matched" },
        evidence: { recognizer: "axios", callee: "classic.get" },
        location: location(hoistedCall, 3),
      },
      {
        method: "GET", path: "/configured", correlation: { status: "matched" },
        evidence: { recognizer: "configured-alias", callee: "client.get" },
        location: location(aliasCall, 4),
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps unsupported diagnostics for shadowed or unknown Vue handlers and Options API templates", async () => {
    const setupImport = '<script setup>import api from "axios";</script>';
    const result = await scan({
      "for.vue": `<template><div v-for="api in clients"><button @click="api.get('/for')">For</button></div></template>${setupImport}`,
      "slot.vue": `<template><Card v-slot="{ api }"><button @click="api.get('/slot')">Slot</button></Card></template>${setupImport}`,
      "unknown.vue": `<template><button @click="loadItems">Load</button></template>${setupImport}`,
      "classic.vue": [
        '<template><button @click="api.get(\'/classic\')">Classic</button></template>',
        '<script>import api from "axios"; export default { methods: {} };</script>',
      ].join("\n"),
    });

    expect(result.usages).toEqual([]);
    expect(result.diagnostics).toEqual([
      { file: "classic.vue", reason: "unsupported-template" },
      { file: "for.vue", reason: "unsupported-template" },
      { file: "slot.vue", reason: "unsupported-template" },
      { file: "unknown.vue", reason: "unsupported-template" },
    ]);
  });

  it("shares hoisted imports across Vue scripts while retaining setup scope and CRLF locations", async () => {
    const setupCall = 'classicHttp.get("/setup")';
    const classicCall = 'setupHttp.get("/classic")';
    const source = [
      '<script setup lang="ts">',
      'import setupHttp from "axios";',
      `  ${setupCall};`,
      'function run(classicHttp: { get(url: string): void }) { classicHttp.get("/shadowed"); }',
      'classicHttp.get(classicPath);',
      '</script>',
      '<template><button>Load</button></template>',
      '<script lang="ts">',
      'import classicHttp from "axios";',
      'const classicPath = "/module-constant";',
      `  ${classicCall};`,
      '</script>',
    ].join("\r\n");
    const result = await scan({ "mixed.vue": source });
    const location = (call: string, line: number) => ({
      file: "mixed.vue", line, column: 2, start: source.indexOf(call), end: source.indexOf(call) + call.length,
    });

    expect(result.usages).toMatchObject([
      {
        method: "GET", path: "/setup",
        evidence: { recognizer: "axios", callee: "classicHttp.get" },
        location: location(setupCall, 3),
      },
      { unresolvedReason: "shadowed-client", location: { file: "mixed.vue", line: 4 } },
      { unresolvedReason: "dynamic-url", location: { file: "mixed.vue", line: 5 } },
      {
        method: "GET", path: "/classic",
        evidence: { recognizer: "axios", callee: "setupHttp.get" },
        location: location(classicCall, 11),
      },
    ]);
    expect(result.usages[2]?.path).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a Vue setup declaration from shadowing the normal script", async () => {
    const result = await scan({
      "shadow.vue": [
        '<script lang="ts">',
        'import http from "axios";',
        'http.get("/module");',
        '</script>',
        '<script setup lang="ts">',
        'const http = { get(_url: string) {} };',
        'http.get("/local");',
        '</script>',
      ].join("\n"),
    });
    expect(result.usages).toMatchObject([
      { method: "GET", path: "/module", location: { line: 3 } },
      { unresolvedReason: "shadowed-client", location: { line: 7 } },
    ]);
    expect(result.usages[1]?.path).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });

  it("deduplicates identical Vue value imports and diagnoses conflicting local aliases", async () => {
    const source = (secondSource: string) => [
      '<script>import http from "axios"; http.get("/classic");</script>',
      `<script setup>import http from "${secondSource}"; http.get("/setup");</script>`,
    ].join("\n");
    const result = await scan({ "identical.vue": source("axios"), "conflicting.vue": source("./other") });
    expect(result.usages).toMatchObject([
      { method: "GET", path: "/classic", location: { file: "identical.vue", line: 1 } },
      { method: "GET", path: "/setup", location: { file: "identical.vue", line: 2 } },
    ]);
    expect(result.diagnostics).toEqual([{ file: "conflicting.vue", reason: "unsupported-script" }]);
  });

  it.each([false, true])("preserves Vue contract observer locations with two script blocks: %s", async (twoBlocks) => {
    const requestCall = `fetch("/items", {method: "POST", headers: {"Content-Type": "application/json"}, body: '{"name":"A"}'})`;
    const responseCall = 'axios.get<{ state: "ready" }>("/items")';
    const source = [
      '<script lang="ts">',
      'import axios from "axios";',
      `  ${responseCall};`,
      ...(twoBlocks ? ["</script>", '<script setup lang="ts">'] : []),
      `  ${requestCall};`,
      "</script>",
    ].join("\r\n");

    const requests: Parameters<NonNullable<IClientConsumptionOptions["observeJsonRequest"]>>[] = [];
    const responses: Parameters<NonNullable<IClientConsumptionOptions["observeJsonResponse"]>>[] = [];
    const result = await scan({ "view.vue": source }, {
      observeJsonRequest: (...args) => { requests.push(args); },
      observeJsonResponse: (...args) => { responses.push(args); },
    });

    expect(result.usages).toHaveLength(2);
    expect(requests).toHaveLength(1);
    expect(responses).toHaveLength(1);
    expect(requests[0]?.[1]).toBe('{"name":"A"}');
    expect(responses[0]?.[0]).toBe(result.usages[0]?.location);
    expect(requests[0]?.[0]).toBe(result.usages[1]?.location);
    for (const [location, text, line] of [
      [responses[0]?.[0], responseCall, 3],
      [requests[0]?.[0], requestCall, twoBlocks ? 6 : 4],
    ] as const) {
      expect(location).toEqual({
        file: "view.vue",
        line,
        column: 2,
        start: source.indexOf(text),
        end: source.indexOf(text) + text.length,
      });
      expect(source.slice(location?.start, location?.end)).toBe(text);
    }
  });

  it.each(["jsx", "tsx"])("scans inline Vue scripts declared as %s", async (lang) => {
    const result = await scan({
      "view.vue": `<script lang="${lang}">export const View = () => <button onClick={() => fetch("/jsx")} />;</script>`,
    });
    expect(result.usages).toMatchObject([{ method: "GET", path: "/jsx" }]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ['<script lang="ts">fetch("/classic")</script><script setup>fetch("/setup")</script>', "unsupported-script"],
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
