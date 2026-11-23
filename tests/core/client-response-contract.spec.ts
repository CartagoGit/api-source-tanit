import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  analyzeClientProjectLinks,
  inspectClientProjectCandidates,
} from "../../packages/core/discovery/client-usage.service.js";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry.js";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture.js";

function objectSchema(required: boolean, values?: string[]) {
  return {
    type: "object",
    required: required ? ["state"] : [],
    additionalProperties: false,
    properties: { state: { type: "string", ...(values === undefined ? {} : { enum: values }) } },
  };
}

function response(schema: object) {
  return { description: "OK", content: { "application/json": { schema } } };
}

function document(title: string, paths: object) {
  return JSON.stringify({ openapi: "3.0.3", info: { title, version: "1.0.0" }, paths });
}

let fixture: ITempProject;

beforeAll(async () => {
  const ready = objectSchema(true, ["ready"]);
  const open = { ...ready, additionalProperties: true };
  fixture = await createTempProject({
    "frontend/client.ts": [
      'import axios from "axios";',
      'axios.get<{ state: "ready" | "busy" }>("/items");',
      'axios.get<{ state: "ready" }>("/wide");',
      'axios.get<{ state: string }>("/optional");',
      'axios.get<{ state?: string }>("/optional");',
      'axios.get<{ state: string }>("/multiple");',
      'axios.get<{ state: string }>("/open");',
      'axios.get<{ state: string | null }>("/nullable", { responseType: "json" });',
      'axios.get<{ state: string }>("/nullable");',
      'axios.get<{ state: string }>("/nullable", { responseType: "text" });',
      'axios.get<{ state: number }>("/integer");',
      'axios.get<{ state: string }>("/wildcard");',
      'axios.get<{ state: string }>("/empty");',
      'axios.get<{ state?: string }>("/integer");',
      'axios.get<Expected>("/items");',
    ].join("\n"),
    "backend/openapi.json": document("Primary response API", {
      "/items": { get: { responses: { "200": response(ready) } } },
      "/wide": { get: { responses: { "200": response(objectSchema(true, ["ready", "busy"])) } } },
      "/optional": { get: { responses: { "200": response(objectSchema(false)) } } },
      "/multiple": { get: { responses: { "200": response(ready), "201": response(ready) } } },
      "/open": { get: { responses: { "200": response(open) } } },
      "/nullable": { get: { responses: { "200": response({
        ...ready, properties: { state: { type: "string", nullable: true }, extra: { type: "boolean" } },
      }) } } },
      "/integer": { get: { responses: { "200": response({
        ...ready, properties: { state: { type: "integer" } },
      }) } } },
      "/wildcard": { get: { responses: { "200": response(ready), "2XX": response(ready) } } },
      "/empty": { get: { responses: { "204": response(ready) } } },
    }),
    "other/openapi.json": document("Secondary response API", {
      "/items": { get: { responses: { "200": response(objectSchema(true, ["private-enum-value"])) } } },
    }),
  }, "tanit-client-response-contract-");
});

afterAll(async () => fixture?.cleanup());

async function selection() {
  const orchestrator = defaultOrchestrator();
  const frontendRoot = join(fixture.root, "frontend");
  const link = async (backend: string) => {
    const backendRoot = join(fixture.root, backend);
    const inventory = await inspectClientProjectCandidates(backendRoot, "backend", orchestrator);
    if (inventory.role !== "backend" || !inventory.services[0]) throw new Error("Expected an OpenAPI service");
    return { frontendRoot, backendRoot, serviceId: inventory.services[0].serviceId };
  };
  return { orchestrator, frontends: [{ root: frontendRoot }], link };
}

it("checks the selected response schema in backend-to-frontend direction", async () => {
  const { orchestrator, frontends, link } = await selection();
  const input = { frontends, links: [await link("backend")] };
  const plain = await analyzeClientProjectLinks(input, orchestrator);
  const compared = await analyzeClientProjectLinks({ ...input, compareResponseBodies: true }, orchestrator);
  const calls = compared.frontends[0]?.calls ?? [];

  expect(calls.map(({ status }) => status)).toEqual(Array(14).fill("matched"));
  expect(calls.map(({ responseContract }) => responseContract?.verdict)).toEqual([
    "compatible", "incompatible", "incompatible", "compatible", "unknown", "unknown",
    "compatible", "incompatible", "unknown", "compatible", "unknown", "unknown",
    "incompatible", "unknown",
  ]);
  expect(calls[1]?.responseContract).toMatchObject({ field: "state" });
  expect(calls[2]?.responseContract).toMatchObject({ field: "state" });
  expect(calls[0]?.responseContract?.status).toBe(200);
  expect(calls[7]?.responseContract?.reason).toBe("type-mismatch");
  expect(calls[8]?.responseContract?.reason).toBe("missing-client-type");
  expect(calls[0]?.responseContract?.source).toMatchObject({
    file: expect.stringMatching(/openapi\.json$/u),
    pointer: expect.any(String),
  });
  expect(plain.frontends[0]?.calls).toEqual(calls.map(({ responseContract, ...call }) => call));
  for (const call of calls) expect(call).not.toHaveProperty("requestContract");

  const onlyRequest = await analyzeClientProjectLinks({ ...input, compareRequestBodies: true }, orchestrator);
  const both = await analyzeClientProjectLinks({ ...input, compareRequestBodies: true, compareResponseBodies: true }, orchestrator);
  expect(onlyRequest.frontends[0]?.calls).toEqual(
    both.frontends[0]?.calls.map(({ responseContract, ...call }) => call),
  );
});

it("uses only the selected service and leaves ambiguous calls unchecked", async () => {
  const { orchestrator, frontends, link } = await selection();
  const primary = await link("backend");
  const other = await link("other");
  const input = { frontends, compareResponseBodies: true };

  const selected = await analyzeClientProjectLinks({ ...input, links: [other] }, orchestrator);
  expect(selected.frontends[0]?.calls[0]).toMatchObject({
    status: "matched",
    responseContract: { verdict: "incompatible", field: "state" },
  });
  expect(JSON.stringify(selected)).not.toContain("private-enum-value");

  const ambiguous = await analyzeClientProjectLinks({ ...input, links: [primary, other] }, orchestrator);
  expect(ambiguous.frontends[0]?.calls[0]?.status).toBe("ambiguous");
  expect(ambiguous.frontends[0]?.calls[0]).not.toHaveProperty("responseContract");
});
