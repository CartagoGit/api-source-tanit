/**
 * Tests for the four non-Postman exporters' handling of
 * `method: "ALL"` (the Hono `.all()` sentinel from commit `aad6376`).
 *
 * x00056 S3: each of these formats — HAR, Bruno, Insomnia, cURL —
 * has no native "any method" verb, so the exporter expands the
 * sentinel into seven standard verbs. None of them carries a
 * provenance marker (only OpenAPI has extension mechanisms; the
 * others have nowhere to attach metadata).
 */
import { describe, expect, test } from "vitest";

import type { EndpointSpec } from "../../../packages/contracts/interfaces/core/postman.interface";
import type { IExportInput } from "../../../packages/contracts/interfaces/core/export-target.interface";
import { HarExporter } from "../../../packages/core/exporters/har.exporter";
import { BrunoExporter } from "../../../packages/core/exporters/bruno.exporter";
import { InsomniaExporter } from "../../../packages/core/exporters/insomnia.exporter";

function spec(method: EndpointSpec["method"], uri: string, extra: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    name: `Spec ${method} ${uri}`,
    method,
    uri,
    ...extra,
  } as EndpointSpec;
}

function baseInput(specs: ReadonlyArray<EndpointSpec>): IExportInput {
  return {
    specs,
    config: {
      name: "test-api",
      collectionName: "Test API",
      collectionDescription: "",
      baseUrl: "http://localhost:3000",
      variables: [],
      filePrefixes: {},
      zones: [],
      zoneOrder: [],
      defaultZone: "Other",
      authDescriptions: {},
      loginEndpointName: "Login",
    } as IExportInput["config"],
    auth: { type: "none" },
  };
}

/** The seven verbs that ALL must materialise as. */
const SEVEN = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

describe("HAR exporter — `method: 'ALL'` expansion (x00056 S3)", () => {
  test("a single ALL spec produces seven log entries", () => {
    const artifacts = new HarExporter().serialize(
      baseInput([spec("ALL", "/api/anything")]),
    );
    expect(artifacts).toHaveLength(1);
    const har = JSON.parse(artifacts[0]!.content) as { log: { entries: Array<{ request: { method: string } }> } };
    const methods = har.log.entries.map((e) => e.request.method);
    expect(methods.sort()).toEqual([...SEVEN].sort());
  });

  test("a GET spec is passed through unchanged (single entry)", () => {
    const artifacts = new HarExporter().serialize(
      baseInput([spec("GET", "/api/users")]),
    );
    const har = JSON.parse(artifacts[0]!.content) as { log: { entries: Array<{ request: { method: string } }> } };
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0]!.request.method).toBe("GET");
  });

  test("an ALL spec mixed with a GET produces 8 entries", () => {
    const artifacts = new HarExporter().serialize(
      baseInput([
        spec("ALL", "/api/x"),
        spec("GET", "/api/y"),
      ]),
    );
    const har = JSON.parse(artifacts[0]!.content) as { log: { entries: unknown[] } };
    expect(har.log.entries).toHaveLength(8);
  });
});

describe("Bruno exporter — `method: 'ALL'` expansion (x00056 S3)", () => {
  test("a single ALL spec produces seven .bru files (one per verb)", () => {
    const artifacts = new BrunoExporter().serialize(
      baseInput([spec("ALL", "/api/anything", { name: "Anything" })]),
    );
    // `bruno.json` + `environments/Local.bru` + 7 × `.bru` files
    const bruFiles = artifacts.filter((a) => a.path.endsWith(".bru"));
    const bruRequests = bruFiles.filter((a) => !a.path.endsWith("Local.bru"));
    expect(bruRequests).toHaveLength(7);
    // Every verb is represented exactly once. The basename starts
    // with the verb (toFileName(`${verb}-${name}.bru`)).
    const seenMethods = new Set<string>();
    for (const f of bruRequests) {
      const basename = f.path.split("/").pop() ?? "";
      const verb = basename.split("-")[0]!.toUpperCase();
      expect(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).toContain(verb);
      seenMethods.add(verb);
    }
    expect(seenMethods.size).toBe(7);
  });

  test("each .bru body contains the corresponding verb in its method block", () => {
    const artifacts = new BrunoExporter().serialize(
      baseInput([spec("ALL", "/api/anything", { name: "Anything" })]),
    );
    const methodsInBlocks = new Set<string>();
    for (const f of artifacts) {
      if (!f.path.endsWith(".bru") || f.path.endsWith("Local.bru")) continue;
      // Bruno's method block: `get {` / `post {` / etc.
      const m = /^(get|post|put|patch|delete|head|options) \{/m.exec(f.content);
      if (m) methodsInBlocks.add(m[1]!.toUpperCase());
    }
    expect(methodsInBlocks.size).toBe(7);
  });
});

describe("Insomnia exporter — `method: 'ALL'` expansion (x00056 S3)", () => {
  test("a single ALL spec produces seven request resources", () => {
    const artifacts = new InsomniaExporter().serialize(
      baseInput([spec("ALL", "/api/anything")]),
    );
    expect(artifacts).toHaveLength(1);
    const doc = JSON.parse(artifacts[0]!.content) as { resources: Array<{ _type: string; method?: string }> };
    const requests = doc.resources.filter((r) => r._type === "request");
    expect(requests).toHaveLength(7);
    const seenMethods = new Set(requests.map((r) => r.method));
    expect(seenMethods.size).toBe(7);
    for (const m of SEVEN) expect(seenMethods.has(m)).toBe(true);
  });

  test("the expanded requests are grouped under the same folder as the original", () => {
    const artifacts = new InsomniaExporter().serialize(
      baseInput([spec("ALL", "/api/anything")]),
    );
    const doc = JSON.parse(artifacts[0]!.content) as { resources: Array<{ _type: string; parentId?: string; method?: string }> };
    const requests = doc.resources.filter((r) => r._type === "request");
    const parents = new Set(requests.map((r) => r.parentId));
    expect(parents.size).toBe(1); // all seven share one parent
  });
});

describe("cURL exporter — `method: 'ALL'` expansion (x00056 S3, scope extension)", () => {
  test("a single ALL spec produces seven `curl -X <VERB>` lines", async () => {
    const { CurlExporter } = await import("../../../packages/core/exporters/har.exporter");
    const artifacts = new CurlExporter().serialize(
      baseInput([spec("ALL", "/api/anything", { name: "Anything" })]),
    );
    expect(artifacts).toHaveLength(1);
    const sh = artifacts[0]!.content;
    // Seven distinct `-X <VERB>` invocations; none is `-X ALL`.
    const verbsInScript = new Set<string>();
    for (const m of sh.matchAll(/-X (\w+)/g)) verbsInScript.add(m[1]!);
    expect(verbsInScript.size).toBe(7);
    expect(verbsInScript.has("ALL")).toBe(false);
  });
});