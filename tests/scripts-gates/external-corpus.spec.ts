import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { artifact, main, materializeCorpus } from "../../scripts/gates/acceptance-external.script.js";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessClaims, canonicalJson, claimMetrics, CorpusCaseSchema, endpointMetrics, jsonValue,
  normalizePath, operationKey, postmanOperations,
} from "../../scripts/helpers/external-corpus.helper.js";

const source = "reviewed source";
const hash = createHash("sha256").update(source).digest("hex");
function oracle() {
  return CorpusCaseSchema.parse({
    version: 1, id: "test-case", framework: "express", repository: "https://github.com/example/api",
    revision: "a".repeat(40), license: { spdx: "MIT", source: "LICENSE" }, inputScope: "Reviewed fixture",
    sourceFiles: { "LICENSE": hash, "src/main.ts": hash },
    endpoints: [{ method: "GET", path: "/health", evidence: ["src/main.ts"] }],
    responses: [{ method: "GET", path: "/health", status: 200, evidence: ["src/main.ts"] }],
    schemaClaims: [{ method: "GET", path: "/health", status: 200, properties: ["status"], types: { status: "string" }, evidence: ["src/main.ts"] }],
  });
}
function collection(responses: unknown[] = []) {
  return { info: { name: "ignored metadata" }, item: [{ name: "Health", request: { method: "GET", url: { raw: "{{baseUrl}}/health", host: ["{{baseUrl}}"], path: ["health"] } }, response: responses }] };
}
function contract(type: string) {
  return { paths: { "/health": { get: { responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } } } } } }, components: { schemas: { Health: { type: "object", properties: { status: { type } } } } } };
}

describe("external acceptance metrics", () => {
  test("normalizes representations without renaming path parameters", () => {
    expect(normalizePath("{{baseUrl}}/users/{{id}}/")).toBe("/users/{id}");
    expect(operationKey({ method: "get", path: "/users/:user" })).toBe("GET /users/{user}");
    expect(normalizePath("/")).toBe("/");
  });
  test("missing routes and false positives have separate denominators", () => {
    expect(endpointMetrics(["GET /a", "GET /b"], ["GET /a", "GET /other"]))
      .toMatchObject({ matched: 1, precision: 0.5, recall: 0.5, missing: ["GET /b"], unexpected: ["GET /other"], passed: false });
  });
  test("duplicates cannot disappear into a set and produce a green gate", () => {
    expect(endpointMetrics(["GET /a"], ["GET /a", "GET /a"]))
      .toMatchObject({ duplicates: ["GET /a"], passed: false });
  });
  test("empty denominators are unmeasured, not 100 percent", () => {
    expect(endpointMetrics(["GET /a"], [])).toMatchObject({ precision: null, recall: 0, passed: false });
    expect(endpointMetrics([], [])).toMatchObject({ precision: null, recall: null });
  });
  test("strict oracles reject duplicate endpoints, missing evidence and path traversal", () => {
    const base = oracle();
    expect(() => CorpusCaseSchema.parse({ ...base, endpoints: [...base.endpoints, ...base.endpoints] })).toThrow();
    expect(() => CorpusCaseSchema.parse({ ...base, sourceFiles: { "../outside.ts": hash } })).toThrow();
    expect(() => CorpusCaseSchema.parse({ ...base, sourceFiles: { "LICENSE": hash } })).toThrow();
    expect(() => jsonValue("{broken")).toThrow("Invalid JSON");
  });
});

describe("semantic parity and independently reviewed claims", () => {
  test("unknowns and empty claim sets do not inflate accuracy or completion", () => {
    expect(claimMetrics([])).toMatchObject({ coverage: null, accuracyAmongObserved: null, complete: null });
    expect(claimMetrics([{ result: "unknown" }])).toMatchObject({ unknown: 1, coverage: 0, accuracyAmongObserved: null, complete: false });
    expect(claimMetrics([{ result: "matched" }, { result: "incorrect" }, { result: "unknown" }])).toMatchObject({ coverage: 2 / 3, accuracyAmongObserved: 0.5, unknown: 1, complete: false });
  });

  test("transport IDs and metadata differ while request/response data remains comparable", () => {
    const left = collection([{ id: "one", code: 200, body: '{"status":"ok"}' }]);
    const right = { ...collection([{ id: "two", code: 200, body: '{"status":"ok"}' }]), info: { name: "different" } };
    expect(canonicalJson(postmanOperations(left))).toBe(canonicalJson(postmanOperations(right)));
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });
  test("an OpenAPI fallback 200 and schema never pretend to be inferred evidence", () => {
    const result = assessClaims(oracle(), collection(), contract("string"));
    expect(result.responses[0]?.result).toBe("unknown");
    expect(result.schemas[0]?.result).toBe("unknown");
    expect(result.fullResponseSchemaAccuracy).toBeNull();
  });
  test("local refs resolve for observed claims; contradictory types fail separately", () => {
    const inferred = collection([{ code: 200 }]);
    expect(assessClaims(oracle(), inferred, contract("string")).schemas[0]?.result).toBe("matched");
    expect(assessClaims(oracle(), inferred, contract("number")).schemas[0]?.result).toBe("incorrect");
    expect(assessClaims(oracle(), inferred, {}).schemas[0]?.result).toBe("unknown");
  });
  test("malformed collections do not quietly become empty successful scans", () => {
    expect(() => postmanOperations({})).toThrow();
    expect(() => postmanOperations({ item: [{}] })).toThrow();
    expect(() => postmanOperations({ item: [{ request: { method: "GET" } }] })).toThrow();
  });
});

describe("verified input materialization", () => {
  test("copies reviewed bytes, ignores unaudited inputs and rejects changed source", async () => {
    const work = await mkdtemp(join(tmpdir(), "tanit-corpus-test-"));
    try {
      const input = join(work, "input");
      await mkdir(join(input, "src"), { recursive: true });
      await writeFile(join(input, "LICENSE"), source);
      await writeFile(join(input, "src/main.ts"), source);
      await writeFile(join(input, "unaudited.js"), "throw new Error('must never execute');");
      await materializeCorpus(input, join(work, "copy"), oracle());
      expect(await readFile(join(work, "copy/src/main.ts"), "utf8")).toBe(source);
      await expect(readFile(join(work, "copy/unaudited.js"), "utf8")).rejects.toThrow();
      await writeFile(join(input, "src/main.ts"), "changed source");
      await expect(materializeCorpus(input, join(work, "changed"), oracle())).rejects.toThrow("hash mismatch");
    } finally { await rm(work, { recursive: true, force: true }); }
  });
  test("rejects invalid UTF-8 even with a matching byte hash", async () => {
    const work = await mkdtemp(join(tmpdir(), "tanit-corpus-encoding-"));
    try {
      const input = join(work, "input");
      await mkdir(join(input, "src"), { recursive: true });
      await writeFile(join(input, "LICENSE"), source);
      const bytes = Buffer.from("fffe", "hex");
      await writeFile(join(input, "src/main.ts"), bytes);
      const corpus = oracle();
      corpus.sourceFiles["src/main.ts"] = createHash("sha256").update(bytes).digest("hex");
      await expect(materializeCorpus(input, join(work, "copy"), corpus)).rejects.toThrow();
    } finally { await rm(work, { recursive: true, force: true }); }
  });
  test("rejects artifacts symlinked outside their output directory", async () => {
    const work = await mkdtemp(join(tmpdir(), "tanit-corpus-artifact-"));
    try {
      const output = join(work, "output");
      await mkdir(output);
      await writeFile(join(work, "outside.json"), "{}");
      const link = join(output, "collection.json");
      await symlink(join(work, "outside.json"), link);
      await expect(artifact(link, output)).rejects.toThrow("outside its output directory");
    } finally { await rm(work, { recursive: true, force: true }); }
  });
  test("a symlink outside the source root is rejected even when its bytes match", async () => {
    const work = await mkdtemp(join(tmpdir(), "tanit-corpus-symlink-"));
    try {
      const input = join(work, "input");
      await mkdir(join(input, "src"), { recursive: true });
      await writeFile(join(input, "LICENSE"), source);
      await writeFile(join(work, "outside.ts"), source);
      await symlink(join(work, "outside.ts"), join(input, "src/main.ts"));
      await expect(materializeCorpus(input, join(work, "copy"), oracle())).rejects.toThrow("escapes input root");
    } finally { await rm(work, { recursive: true, force: true }); }
  });
});


describe("real offline acceptance runner", () => {
  test("compares real CLI/API exports, reports missing routes and replaces stale success after input tampering", async () => {
    const work = await mkdtemp(join(tmpdir(), "tanit-corpus-runner-"));
    try {
      const input = join(work, "source");
      await mkdir(input);
      const files: Record<string, string> = {
        "LICENSE": "Owned synthetic test fixture",
        "package.json": '{"name":"acceptance-fixture","dependencies":{"express":"^4.18.0"},"scripts":{"preinstall":"exit 99"}}',
        "main.js": `const express = require('express'); const app = express(); app.get('/health', (req,res) => res.json({status:'ok'}));`,
      };
      for (const [path, content] of Object.entries(files)) await writeFile(join(input, path), content);
      const corpus = CorpusCaseSchema.parse({
        ...oracle(), id: "synthetic-case", inputScope: "Only Tanit-owned synthetic test inputs",
        license: { spdx: "test-fixture", source: "LICENSE" },
        sourceFiles: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, createHash('sha256').update(content).digest('hex')])),
        endpoints: [{ method: "GET", path: "/health", evidence: ["main.js"] }], responses: [], schemaClaims: [],
      });
      const report = join(work, "result.json");
      const args = ['--case=synthetic-case', `--project-root=${input}`, `--report=${report}`];
      expect(await main(args, async () => corpus, 'bun')).toBe(0);
      expect(jsonValue(await readFile(report, 'utf8'))).toMatchObject({ passed: true, semanticParity: true, contractsParity: true, responseSchemaClaimsComplete: null, betaReleaseCertified: false });
      const incomplete = CorpusCaseSchema.parse({ ...corpus, endpoints: [...corpus.endpoints, {method:'GET',path:'/missing',evidence:['main.js']}] });
      expect(await main(args, async () => incomplete, 'bun')).toBe(1);
      expect(jsonValue(await readFile(report, 'utf8'))).toMatchObject({ passed: false, routing: {cli:{recall:0.5,missing:['GET /missing']}} });
      await writeFile(join(input,'main.js'), 'changed');
      await expect(main(args, async () => corpus, 'bun')).rejects.toThrow('hash mismatch');
      expect(jsonValue(await readFile(report, 'utf8'))).toMatchObject({passed:false,status:'execution-error'});
    } finally { await rm(work, {recursive:true,force:true}); }
  }, 30_000);
});
