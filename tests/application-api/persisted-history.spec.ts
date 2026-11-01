/**
 * The persisted history: the revisions of a project, and what can be
 * done with them.
 *
 * ## What these tests are for
 *
 * The history was a **shape and a comparison with nothing to compare**:
 * `diffSnapshots()` was written and tested against a canonical
 * snapshot that nobody produced, and the recorder that should have
 * produced it kept its records in a `Map` inside a process that ended
 * when the command did. So the app's five calls — list the revisions,
 * compare two, say how they were configured, export one again, restore
 * one — answered `UNKNOWN_HANDLER`, and the screens that would have
 * drawn them were not mounted.
 *
 * These tests pin the three things that make it real:
 *
 *   1. **A record survives the process.** It is written to disk, and
 *      it comes back — including the parts that JSON cannot express
 *      on its own (a `Map`, a `Date`), which is why there is a codec.
 *   2. **The comparison answers what changed.** Two revisions that
 *      differ say so, with the difference and not with a shrug.
 *   3. **A revision can be exported again and restored.** The
 *      collection that comes back is the one that was recorded.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { dispatch, type IRequestContext } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { ProjectHistoryService } from "../../packages/core/session/project-history.service.js";
import { decodeSnapshot, encodeSnapshot } from "../../packages/core/session/snapshot-codec.helper.js";
import { HISTORY_STORE_ENVIRONMENT_VARIABLE } from "../../packages/contracts/constants/core/state-store.constant.js";
import type { IGenerationResult } from "../../packages/contracts/interfaces/core/discovery.interface.js";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/endpoint-legacy.interface.js";
import type { IProjectMatch } from "../../packages/contracts/interfaces/core/scanner.interface.js";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface.js";
import type { PostmanCollection } from "../../packages/contracts/interfaces/core/postman.interface.js";

let work = "";
let previousOverride: string | undefined;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "core-history-"));
  previousOverride = process.env[HISTORY_STORE_ENVIRONMENT_VARIABLE];
  process.env[HISTORY_STORE_ENVIRONMENT_VARIABLE] = work;
});

afterEach(async () => {
  if (previousOverride === undefined) {
    delete process.env[HISTORY_STORE_ENVIRONMENT_VARIABLE];
  } else {
    process.env[HISTORY_STORE_ENVIRONMENT_VARIABLE] = previousOverride;
  }
  await rm(work, { recursive: true, force: true });
});

/** One endpoint, with the fields the history looks at. */
function spec(overrides: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    name: "get-users",
    method: "GET",
    uri: "/users",
    transport: "http",
    ...overrides,
  };
}

/** The collection of one service. */
function collection(name: string): PostmanCollection {
  return {
    info: { name, description: "", schema: "v2.1.0" },
    variable: [{ key: "baseUrl", value: "http://localhost" }],
    item: [],
  };
}

/** One service, as the pipeline produced it. */
function result(overrides: Partial<IGenerationResult> = {}): IGenerationResult {
  const config: ProjectConfig = {
    name: "api",
    collectionName: "api",
    collectionDescription: "",
    baseUrl: "http://localhost",
    variables: [],
  };
  const match: IProjectMatch = {
    framework: "express",
    projectRoot: "/project",
    frameworkSearchRoot: undefined,
  };
  return {
    collection: collection("api"),
    specs: [spec()],
    routes: [],
    config,
    match,
    origin: "scanner",
    authFlow: null,
    authScheme: { type: "bearer", evidence: "the authorization header says so" },
    context: {
      projectRoot: "/project",
      packageRoot: "/package",
      projectBasename: "project",
      outputDir: "/project/tanit",
    },
    warnings: [],
    frameworks: ["express"],
    serviceId: "api",
    ...overrides,
  };
}

/** A snapshot of a project, at a given moment. */
function snapshot(at: string, overrides: Partial<IGenerationResult> = {}) {
  return {
    sessionId: "session:1",
    projectRoot: "/project",
    capturedAt: new Date(at),
    results: [result(overrides)],
    diagnostics: [],
    frameworks: ["express"],
  };
}

/** The context every call needs. */
function ctx(): IRequestContext {
  return { caller: "desktop" };
}

describe("the persisted history", () => {
  test("a record survives the process, and comes back whole", async () => {
    const history = new ProjectHistoryService();
    const recorded = await history.record(
      "/project",
      snapshot("2026-11-01T10:00:00.000Z"),
      { formats: ["postman"], output: "/project/tanit", source: "export", configuration: { formats: ["postman"] } },
    );

    const found = await history.get("/project", recorded.id);
    expect(found?.id).toBe(recorded.id);
    expect(found?.count).toBe(1);
    expect(found?.formats).toEqual(["postman"]);
    expect(found?.sha256).toBe(recorded.sha256);
    expect(found?.provenance.source).toBe("export");

    // The whole snapshot comes back too, which is what makes a
    // revision exportable again and restorable.
    const restored = await history.snapshotOf("/project", recorded.id);
    expect(restored?.results[0]?.specs[0]?.uri).toBe("/users");
    expect(restored?.capturedAt).toBeInstanceOf(Date);
    expect(restored?.capturedAt.toISOString()).toBe("2026-11-01T10:00:00.000Z");
  });

  test("the list says what each revision was, without carrying the snapshots", async () => {
    const history = new ProjectHistoryService();
    await history.record("/project", snapshot("2026-11-01T10:00:00.000Z"), { formats: ["postman"], source: "export" });
    await history.record("/project", snapshot("2026-11-02T10:00:00.000Z"), { formats: ["postman"], source: "scan" });

    const revisions = await history.summaries("/project");
    expect(revisions.length).toBe(2);
    // Newest first: the revision somebody wants is the last one.
    expect(revisions[0]?.timestamp).toBe("2026-11-02T10:00:00.000Z");
    expect(revisions[0]?.source).toBe("scan");
    expect(revisions[0]?.count).toBe(1);
  });

  test("the comparison says what changed between two revisions", async () => {
    const history = new ProjectHistoryService();
    const left = await history.record("/project", snapshot("2026-11-01T10:00:00.000Z"), {
      configuration: { mode: "one" },
    });
    const right = await history.record(
      "/project",
      snapshot("2026-11-02T10:00:00.000Z", {
        specs: [spec({ method: "POST", uri: "/users" }), spec({ name: "create-user", method: "POST", uri: "/users/new" })],
      }),
      { configuration: { mode: "two" } },
    );

    const diff = await history.compare("/project", left.id, right.id);
    expect(diff.added).toContain("operation:api/create-user");
    expect(diff.changed).toContain("operation:api/get-users");
    expect(diff.configuration).toEqual({ before: { mode: "one" }, after: { mode: "two" } });

    const configuration = await history.compareConfiguration("/project", left.id, right.id);
    expect(configuration).toEqual({ before: { mode: "one" }, after: { mode: "two" } });
  });

  test("a comparison with a revision that is not there says so", async () => {
    const history = new ProjectHistoryService();
    const left = await history.record("/project", snapshot("2026-11-01T10:00:00.000Z"));
    await expect(history.compare("/project", left.id, "missing")).rejects.toThrow(
      "does not exist",
    );
  });

  test("a project without history has no revisions", async () => {
    const history = new ProjectHistoryService();
    expect(await history.list("/nothing")).toEqual([]);
    expect(await history.get("/nothing", "whatever")).toBeUndefined();
  });
});

describe("the snapshot codec", () => {
  test("a map and a date come back as a map and a date", () => {
    const value = {
      when: new Date("2026-11-01T10:00:00.000Z"),
      nodes: new Map<string, { id: string }>([["a", { id: "a" }]]),
      nested: [{ inner: new Map<string, number>([["n", 1]]) }],
    };
    const decoded = decodeSnapshot(encodeSnapshot(value)) as typeof value;

    expect(decoded.when).toBeInstanceOf(Date);
    expect(decoded.when.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(decoded.nodes.get("a")).toEqual({ id: "a" });
    expect(decoded.nested[0]?.inner.get("n")).toBe(1);
  });

  test("an object with a tag-like key is still data", () => {
    const decoded = decodeSnapshot('{"$map":"not a map"}') as Record<string, unknown>;
    expect(decoded["$map"]).toBe("not a map");
  });

  test("the file on disk is readable text", async () => {
    const history = new ProjectHistoryService();
    const recorded = await history.record("/project", snapshot("2026-11-01T10:00:00.000Z"));
    // One folder per project, named after the hash of its path.
    const projects = await readdir(work);
    expect(projects.length).toBe(1);
    const entries = await readdir(join(work, projects[0] ?? ""));
    expect(entries.length).toBe(1);
    const text = await readFile(join(work, projects[0] ?? "", entries[0] ?? ""), "utf8");
    expect(JSON.parse(text).record.id).toBe(recorded.id);
  });
});

describe("the handlers of the persisted history", () => {
  test("the list answers with the revisions and their count", async () => {
    const registry = buildRegistry();
    const history = new ProjectHistoryService();
    await history.record("/project", snapshot("2026-11-01T10:00:00.000Z"), { source: "export" });

    const answer = await dispatch(registry, "history-list", { projectRoot: "/project" }, ctx());
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.total).toBe(1);
    expect(answer.value.entries[0]?.source).toBe("export");
  });

  test("the diff answers with the difference, in the root", async () => {
    const registry = buildRegistry();
    const history = new ProjectHistoryService();
    const left = await history.record("/project", snapshot("2026-11-01T10:00:00.000Z"));
    const right = await history.record(
      "/project",
      snapshot("2026-11-02T10:00:00.000Z", { specs: [spec({ name: "other", uri: "/other" })] }),
    );

    const answer = await dispatch(
      registry,
      "history-diff",
      { projectRoot: "/project", leftId: left.id, rightId: right.id },
      ctx(),
    );
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.added).toContain("operation:api/other");
    expect(answer.value.removed).toContain("operation:api/get-users");
  });

  test("the configuration of two revisions comes back side by side", async () => {
    const registry = buildRegistry();
    const history = new ProjectHistoryService();
    const left = await history.record("/project", snapshot("2026-11-01T10:00:00.000Z"), {
      configuration: { outputDirectory: "/one" },
    });
    const right = await history.record("/project", snapshot("2026-11-02T10:00:00.000Z"), {
      configuration: { outputDirectory: "/two" },
    });

    const answer = await dispatch(
      registry,
      "history-compare-config",
      { projectRoot: "/project", leftId: left.id, rightId: right.id },
      ctx(),
    );
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.before).toEqual({ outputDirectory: "/one" });
    expect(answer.value.after).toEqual({ outputDirectory: "/two" });
  });

  test("a revision that is not there is an error, not an empty answer", async () => {
    const registry = buildRegistry();
    const answer = await dispatch(
      registry,
      "history-diff",
      { projectRoot: "/project", leftId: "missing", rightId: "missing" },
      ctx(),
    );
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error.code).toBe("OPERATION_NOT_FOUND");
  });
});
