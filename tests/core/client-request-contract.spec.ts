import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import {
  analyzeClientProjectLinks,
  inspectClientProjectCandidates,
} from "../../packages/core/discovery/client-usage.service.js";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry.js";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture.js";

const request = (schema: object) => ({
  post: {
    requestBody: { required: true, content: { "application/json": { schema } } },
    responses: { "200": { description: "OK" } },
  },
});

const closedObject = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: { type: "string" } },
};

let fixture: ITempProject;

beforeAll(async () => {
  fixture = await createTempProject({
    "frontend/client.ts": [
      `fetch("/items", {method: "POST", headers: {"Content-Type": "application/json"}, body: '{"name":"private-name-sentinel"}'});`,
      `fetch("/items", {method: "POST", headers: {"Content-Type": "application/json"}, body: '{}'});`,
      `fetch("/items", {method: "POST", headers: {"Content-Type": "application/json"}, body: '{"name":31415926}'});`,
      `fetch("/items", {method: "POST", headers: {"Content-Type": "application/json"}, body: runtimeBody});`,
      `fetch("/items", {method: "POST", headers: {"Content-Type": "text/plain"}, body: 'plaintext-sentinel'});`,
      `fetch("/items", {method: "POST", headers: {"Content-Type": "application/json"}, body: '{"name":"one","name":"two"}'});`,
      `fetch("/items", {method: "POST", mode: "no-cors", headers: {"Content-Type": "application/json"}, body: '{"name":"no-cors-sentinel"}'});`,
      `fetch("/unsupported", {method: "POST", headers: {"Content-Type": "application/json"}, body: '{"name":"unsupported-sentinel"}'});`,
    ].join("\n"),
    "backend/openapi.json": JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Item requests", version: "1.0.0" },
      paths: {
        "/items": request(closedObject),
        "/unsupported": request({ oneOf: [closedObject, { type: "string" }] }),
      },
    }),
    "other/openapi.json": JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Other API", version: "1.0.0" },
      paths: { "/items": request({ ...closedObject, properties: { name: { type: "integer" } } }) },
    }),
  }, "tanit-client-request-contract-");
});

afterAll(async () => fixture?.cleanup());

it("compares static JSON only with the uniquely selected OpenAPI request schema", async () => {
  const orchestrator = defaultOrchestrator();
  const frontendRoot = join(fixture.root, "frontend");
  const backendRoot = join(fixture.root, "backend");
  const inventory = await inspectClientProjectCandidates(backendRoot, "backend", orchestrator);
  if (inventory.role !== "backend" || !inventory.services[0]) throw new Error("Expected an OpenAPI service");
  const { serviceId } = inventory.services[0];
  const selection = {
    frontends: [{ root: frontendRoot }],
    links: [{ frontendRoot, backendRoot, serviceId }],
  };
  const plain = await analyzeClientProjectLinks(selection, orchestrator);
  const compared = await analyzeClientProjectLinks({ ...selection, compareRequestBodies: true }, orchestrator);
  const calls = compared.frontends[0]?.calls ?? [];

  expect(calls.map(({ status }) => status)).toEqual(Array(8).fill("matched"));
  expect(calls.map(({ candidates }) => candidates.length)).toEqual(Array(8).fill(1));
  expect(calls.map(({ requestContract }) => requestContract?.verdict)).toEqual([
    "compatible", "incompatible", "incompatible", "unknown", "unknown", "unknown", "unknown", "unknown",
  ]);
  expect(calls[1]?.requestContract).toMatchObject({ reason: expect.any(String), field: expect.any(String) });
  expect(calls[2]?.requestContract).toMatchObject({ reason: expect.any(String), field: expect.any(String) });
  expect(calls[1]?.requestContract?.reason).not.toEqual(calls[2]?.requestContract?.reason);
  expect(calls[5]?.requestContract).toMatchObject({ verdict: "unknown", reason: "unsupported-json" });
  expect(calls[6]?.requestContract).toMatchObject({ verdict: "unknown", reason: "missing-client-json" });
  expect(calls[0]?.requestContract?.source).toMatchObject({
    file: expect.stringMatching(/openapi\.json$/u),
    pointer: expect.any(String),
  });
  expect(plain.frontends[0]?.calls).toEqual(calls.map(({ requestContract, ...call }) => call));
  expect(JSON.stringify(compared)).not.toMatch(/(?:private-name-sentinel|31415926|plaintext-sentinel|unsupported-sentinel|no-cors-sentinel)/u);
});

it("uses the selected service only and leaves ambiguous operations unchecked", async () => {
  const orchestrator = defaultOrchestrator();
  const frontendRoot = join(fixture.root, "frontend");
  const firstRoot = join(fixture.root, "backend");
  const otherRoot = join(fixture.root, "other");
  const link = async (backendRoot: string) => {
    const inventory = await inspectClientProjectCandidates(backendRoot, "backend", orchestrator);
    if (inventory.role !== "backend" || !inventory.services[0]) throw new Error("Expected a service");
    return { frontendRoot, backendRoot, serviceId: inventory.services[0].serviceId };
  };
  const first = await link(firstRoot);
  const other = await link(otherRoot);
  const input = { frontends: [{ root: frontendRoot }], compareRequestBodies: true };
  const selected = await analyzeClientProjectLinks({ ...input, links: [other] }, orchestrator);
  expect(selected.frontends[0]?.calls[0]?.requestContract).toMatchObject({
    verdict: "incompatible", reason: "type-mismatch", field: "name",
  });
  expect(selected.frontends[0]?.calls[2]?.requestContract?.verdict).toBe("compatible");

  const ambiguous = await analyzeClientProjectLinks({ ...input, links: [first, other] }, orchestrator);
  expect(ambiguous.frontends[0]?.calls[0]?.status).toBe("ambiguous");
  expect(ambiguous.frontends[0]?.calls[0]?.requestContract).toBeUndefined();
});
