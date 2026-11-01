/**
 * The project verbs, end to end, against a real project on disk.
 *
 * ## Why this test exists
 *
 * `check`, `validate`, `stats`, `push` and `sync` were **CLI-only**:
 * the logic lived inside the command scripts, and the app had a
 * screen for each of them that could only ever say "not available
 * yet".
 *
 * The logic moved to the core and the Application API exposes it, so
 * now the question is not "does the handler exist" but "does it
 * answer the same thing the CLI answers". This test opens a **real**
 * project, writes the collection through the API, and then asks the
 * API about it — the same round trip the app makes.
 *
 * It lives in `tests/e2e/` because it needs the real orchestrator,
 * and the orchestrator lives with the frameworks.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { dispatch, type IRequestContext } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { closeAllSessions } from "../../packages/core/session/project-session.service.js";
import { defaultOrchestrator } from "../../packages/frameworks/index.js";
import { exampleDir } from "../../scripts/helpers/root.helper.js";
import { copyExampleClean } from "../helpers/fixtures.js";
import type {
  CheckOutput,
  PushOutput,
  StatsOutput,
  SyncOutput,
  ValidateOutput,
} from "../../packages/contracts/interfaces/core/application-api.interface.js";

/** The context the handlers need: the real orchestrator and a caller. */
function context(): IRequestContext {
  return { caller: "browser", orchestrator: defaultOrchestrator() };
}

describe("the project verbs, end to end", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "project-verbs-"));
    await copyExampleClean(exampleDir("express"), root);
  }, 60_000);

  afterEach(async () => {
    closeAllSessions();
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("the registry answers for all five", () => {
    const registry = buildRegistry();

    for (const name of ["check", "validate", "stats", "push", "sync"]) {
      expect(registry[name]).toBeDefined();
    }
  });

  test("sync writes the collection the other verbs look for", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());

    const answer = await dispatch(buildRegistry(), "sync", { projectRoot: root }, context());

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const synced = answer.value as SyncOutput;
    expect(synced.files.length).toBeGreaterThan(0);
    expect(synced.dryRun).toBe(false);
    expect(existsSync(synced.files[0]!)).toBe(true);
  }, 120_000);

  test("a dry run writes nothing", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());

    const answer = await dispatch(buildRegistry(), "sync", {
      projectRoot: root,
      dryRun: true,
    }, context());

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const planned = answer.value as SyncOutput;
    expect(planned.files).toHaveLength(0);
    expect(planned.plannedFiles.length).toBeGreaterThan(0);
    expect(existsSync(planned.plannedFiles[0]!.path)).toBe(false);
  }, 120_000);

  test("check compares the collection with the code", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());
    await dispatch(buildRegistry(), "sync", { projectRoot: root }, context());

    const answer = await dispatch(buildRegistry(), "check", { projectRoot: root }, context());

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const checked = answer.value as CheckOutput;
    expect(checked.report.routesInSource).toBeGreaterThan(0);
    expect(checked.report.requestsInCollection).toBeGreaterThan(0);
    expect(checked.report.collectionPath).toContain("postman_collection");
    // The collection was just written from these very routes: there
    // is nothing missing on either side.
    expect(checked.report.missingInCollection).toHaveLength(0);
    expect(checked.report.missingInSource).toHaveLength(0);
    expect(checked.report.inSync).toBe(true);
  }, 120_000);

  test("validate accepts the collection the app wrote", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());
    await dispatch(buildRegistry(), "sync", { projectRoot: root }, context());

    const answer = await dispatch(buildRegistry(), "validate", { projectRoot: root }, context());

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const validated = answer.value as ValidateOutput;
    expect(validated.result.requests).toBeGreaterThan(0);
    expect(validated.result.errors).toHaveLength(0);
    expect(validated.result.ok).toBe(true);
  }, 120_000);

  test("stats counts the collection the app wrote", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());
    await dispatch(buildRegistry(), "sync", { projectRoot: root }, context());

    const answer = await dispatch(buildRegistry(), "stats", { projectRoot: root }, context());

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const stats = answer.value as StatsOutput;
    expect(stats.stats.total).toBeGreaterThan(0);
    expect(stats.stats.byMethod.length).toBeGreaterThan(0);
  }, 120_000);

  test("push says what it needs when there is no key", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());

    const answer = await dispatch(buildRegistry(), "push", { projectRoot: root }, context());

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const pushed = answer.value as PushOutput;
    expect(pushed.collection).toBeNull();
    expect(pushed.environments).toHaveLength(0);
    expect(pushed.error).not.toBeNull();
    expect(pushed.error?.reason).toContain("API key");
  }, 120_000);

  test("a dry run of push uploads nothing", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());

    const answer = await dispatch(buildRegistry(), "push", {
      projectRoot: root,
      apiKey: "not-a-real-key",
      dryRun: true,
    }, context());

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const pushed = answer.value as PushOutput;
    expect(pushed.dryRun).toBe(true);
    expect(pushed.collection).toBeNull();
    expect(pushed.environments).toHaveLength(0);
  }, 120_000);
});
