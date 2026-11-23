import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import type { DryRunOutput, ExportOutput } from "../../packages/contracts/interfaces/core/application-api.interface.js";
import { dispatch } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { closeAllSessions } from "../../packages/core/session/project-session.service.js";
import { defaultOrchestrator } from "../../packages/frameworks/index.js";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture.js";

let fixture: ITempProject | undefined;
const registry = buildRegistry();
const context = { caller: "browser" as const, orchestrator: defaultOrchestrator() };

afterEach(async () => {
  closeAllSessions();
  await fixture?.cleanup();
  fixture = undefined;
});

test("opts into sanitized per-operation consumer counts with preview and history parity", async () => {
  fixture = await createTempProject({
    "backend/openapi.json": JSON.stringify({
      openapi: "3.0.3", info: { title: "Items API", version: "1.0.0" },
      paths: {
        "/items": { get: { responses: { "200": { description: "OK" } } } },
        "/unused": { get: { responses: { "200": { description: "OK" } } } },
      },
    }),
    "frontend/client.ts": [
      'fetch("/items");',
      'fetch("/items");',
      'fetch("/missing", { method: "POST", body: "private-consumer-body-sentinel" });',
      'fetch(runtimeUrl());',
    ].join("\n"),
    "other-frontend/client.ts": 'fetch("/items");',
  }, "tanit-consumer-export-");
  const projectRoot = join(fixture.root, "backend");
  const frontendRoot = join(fixture.root, "frontend");
  expect(await dispatch(registry, "open-project", { projectRoot }, context)).toMatchObject({ ok: true });

  const base = { projectRoot, target: "openapi" };
  const standard = await dispatch<ExportOutput>(registry, "export", { ...base, outputPath: "standard.yaml" }, context);
  if (!standard.ok) throw new Error(standard.error.message);
  const standardYaml = await readFile(standard.value.outputPath, "utf8");
  expect(standardYaml).not.toContain("x-tanit-consumers");

  // Preview and export use the open backend snapshot even when its files change.
  await writeFile(join(projectRoot, "openapi.json"), "{}");

  const outputPath = join(projectRoot, "annotated.yaml");
  const input = {
    ...base,
    outputPath,
    consumerFrontends: [{ root: frontendRoot }, { root: join(fixture.root, "other-frontend") }],
  };
  const before = (await readdir(fixture.root, { recursive: true })).sort();
  const preview = await dispatch<DryRunOutput>(registry, "dry-run", input, context);
  if (!preview.ok) throw new Error(preview.error.message);
  expect(preview.value.files).toMatchObject([{ path: outputPath, change: "NEW" }]);
  expect(existsSync(outputPath)).toBe(false);
  expect((await readdir(fixture.root, { recursive: true })).sort()).toEqual(before);

  const annotated = await dispatch<ExportOutput>(registry, "export", input, context);
  if (!annotated.ok) throw new Error(annotated.error.message);
  const yaml = await readFile(outputPath, "utf8");
  expect(preview.value.files[0]?.bytes).toBe(Buffer.byteLength(yaml));
  expect(annotated.value.bytes).toBe(Buffer.byteLength(yaml));
  expect(yaml.match(/x-tanit-consumers:/gu)).toHaveLength(1);
  const item = /^  "\/items":\r?\n((?: {4,}[^\n]*\n)*)/mu.exec(yaml)?.[1];
  const extension = /^      x-tanit-consumers:\r?\n((?: {8,}[^\n]*\n)*)/mu.exec(item ?? "")?.[1];
  expect(item).toMatch(/^    get:/mu);
  expect(extension).toMatch(/^        confirmedCalls: 3$/mu);
  expect(extension).toMatch(/^        frontends: 2$/mu);
  expect(yaml.replace(/^      x-tanit-consumers:\r?\n(?: {8,}[^\n]*\n)*/mu, "")).toBe(standardYaml);
  expect(yaml).not.toContain(frontendRoot);
  expect(yaml).not.toContain("private-consumer-body-sentinel");
  expect(yaml).not.toContain("client.ts");

  expect(await dispatch(registry, "dry-run", { ...input, target: "postman" }, context))
    .toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

  if (!annotated.value.historyId || !standard.value.historyId) throw new Error("Expected persisted export revisions");
  const standardRevision = await dispatch<ExportOutput>(registry, "history-re-export", {
    projectRoot,
    historyId: standard.value.historyId,
    target: "openapi",
    outputDirectory: join(fixture.root, "standard-history"),
  }, context);
  if (!standardRevision.ok) throw new Error(standardRevision.error.message);
  expect(await readFile(standardRevision.value.outputPath, "utf8")).toBe(standardYaml);
  await writeFile(join(frontendRoot, "client.ts"), 'fetch("/unused");');
  const reExport = await dispatch<ExportOutput>(registry, "history-re-export", {
    projectRoot,
    historyId: annotated.value.historyId,
    target: "openapi",
    outputDirectory: join(fixture.root, "history-export"),
  }, context);
  if (!reExport.ok) throw new Error(reExport.error.message);
  expect(await readFile(reExport.value.outputPath, "utf8")).toBe(yaml);
});

test("rejects consumer annotation for multiple generated services before writing", async () => {
  fixture = await createTempProject({
    "backend/package.json": JSON.stringify({ private: true, workspaces: ["apps/*"] }),
    "backend/apps/catalog/package.json": JSON.stringify({ name: "catalog", dependencies: { "@nestjs/core": "^10.0.0" } }),
    "backend/apps/catalog/src/items.controller.ts": [
      'import { Controller, Get } from "@nestjs/common";',
      '@Controller("items")',
      'export class ItemsController { @Get() list() { return []; } }',
    ].join("\n"),
    "backend/apps/orders/package.json": JSON.stringify({ name: "orders", dependencies: { express: "^4.19.0" } }),
    "backend/apps/orders/server.js": [
      'const express = require("express");',
      'const app = express();',
      'app.get("/orders", (_req, res) => res.json([]));',
    ].join("\n"),
    "frontend/client.ts": 'fetch("/items");',
  }, "tanit-consumer-multiservice-");
  const projectRoot = join(fixture.root, "backend");
  const outputPath = join(projectRoot, "annotated.yaml");
  expect(await dispatch(registry, "open-project", { projectRoot }, context)).toMatchObject({ ok: true });

  expect(await dispatch(registry, "export", {
    projectRoot, target: "openapi", outputPath, consumerFrontends: [{ root: join(fixture.root, "frontend") }],
  }, context)).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  expect(existsSync(outputPath)).toBe(false);
});
