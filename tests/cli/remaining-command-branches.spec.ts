/**
 * High-value command branches for c00010 S3.
 *
 * Keep these cases in-process where possible so V8 records the command
 * code itself; only the `push` transport is faked at the fetch boundary.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { URL } from "node:url";

import { runPush } from "../../packages/cli/commands/push.script";
import { main as watchMain } from "../../packages/cli/commands/watch.script";
import { runGenerate } from "../../packages/cli/commands/generate.script";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";
let previousKey: string | undefined;
let previousRoot: string | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  if (previousKey === undefined) delete process.env["POSTMAN_API_KEY"];
  else process.env["POSTMAN_API_KEY"] = previousKey;
  if (previousRoot === undefined) delete process.env["POSTMAN_PROJECT_ROOT"];
  else process.env["POSTMAN_PROJECT_ROOT"] = previousRoot;
  if (work) await rm(work, { recursive: true, force: true });
  work = "";
});

async function generatedProject(name: string): Promise<string> {
  if (!work) work = await mkdtemp(join(tmpdir(), "cli-branches-"));
  const root = join(work, name);
  await copyExampleClean(exampleDir("express"), root);
  const outcome = await runGenerate(["--project-root", root]);
  expect(outcome.code, "runGenerate must succeed").toBe(0);
  return root;
}

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

function jsonResponse(status: number, body: unknown): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as FetchResponse;
}

function postmanFetch(overrides: {
  readonly me?: { status: number; body: unknown };
  readonly collections?: { status: number; body: unknown };
  readonly environments?: { status: number; body: unknown };
}): typeof fetch {
  return (async (input: string | URL, _init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname === "/me") {
      return jsonResponse(overrides.me?.status ?? 200, overrides.me?.body ?? {
        user: { id: 7, username: "coverage-user" },
      });
    }
    if (pathname === "/collections") {
      const body = overrides.collections?.body ?? {
        collections: [],
        collection: { uid: "collection-uid" },
      };
      return jsonResponse(overrides.collections?.status ?? 200, body);
    }
    if (pathname.startsWith("/collections/")) {
      return jsonResponse(200, { collection: { uid: "existing-collection" } });
    }
    if (pathname === "/environments") {
      const body = overrides.environments?.body ?? {
        environments: [],
        environment: { uid: "environment-uid" },
      };
      return jsonResponse(overrides.environments?.status ?? 200, body);
    }
    return jsonResponse(404, { error: "not found" });
  }) as typeof fetch;
}

describe("push — successful upload branches", () => {
  test("uploads a collection and environments with workspace and API-key flags", async () => {
    const root = await generatedProject("push-success");
    previousKey = process.env["POSTMAN_API_KEY"];
    vi.stubGlobal("fetch", postmanFetch({}));

    const outcome = await runPush([
      "--project-root",
      root,
      "--api-key",
      "pmak-coverage",
      "--workspace",
      "workspace-coverage",
    ]);

    expect(outcome.code).toBe(0);
    expect(outcome.user).toBe("coverage-user");
    expect(outcome.framework).toBe("express");
    expect(outcome.collection).toEqual({
      action: "created",
      uid: "collection-uid",
      name: "sample-express (Postman)",
    });
    expect(outcome.environments).toHaveLength(4);
    expect(outcome.environments.every((item) => item.uid === "environment-uid")).toBe(true);
  });

  test("preserves an existing collection and exercises the update action", async () => {
    const root = await generatedProject("push-existing");
    const fs = await import("node:fs/promises");
    const collection = JSON.parse(
      await fs.readFile(join(root, "tanit", "sample-express.postman_collection.json"), "utf8"),
    ) as { info: { _postman_id?: string } };
    const collectionId = collection.info._postman_id;
    expect(collectionId).toBeDefined();
    vi.stubGlobal(
      "fetch",
      postmanFetch({
        collections: {
          status: 200,
          body: {
            collections: [{ uid: "existing-collection", id: collectionId, name: "sample-express" }],
            collection: { uid: "collection-uid" },
          },
        },
      }),
    );

    const outcome = await runPush([
      "--project-root",
      root,
      "--api-key",
      "pmak-coverage",
      "--no-environments",
    ]);
    expect(outcome.code).toBe(0);
    expect(outcome.collection).toEqual({
      action: "updated",
      uid: "existing-collection",
      name: "sample-express (Postman)",
    });
  });

  test("returns a redacted Postman error when collection upload fails", async () => {
    const root = await generatedProject("push-upload-403");
    vi.stubGlobal(
      "fetch",
      postmanFetch({
        me: { status: 200, body: { user: { id: 1, username: "coverage-user" } } },
        collections: { status: 403, body: "do not print pmak-coverage-secret" },
      }),
    );

    const outcome = await runPush([
      "--project-root",
      root,
      "--api-key",
      "pmak-coverage-secret",
      "--no-environments",
    ]);
    expect(outcome.code).toBe(1);
    expect(outcome.user).toBe("coverage-user");
    expect(outcome.framework).toBe("express");
    expect(outcome.requests).toBeGreaterThan(0);
    expect(outcome.error?.reason).toContain("403");
    expect(JSON.stringify(outcome)).not.toContain("pmak-coverage-secret");
  });
});

describe("watch — command flag branches", () => {
  test("honours an explicit framework and a relative search root", async () => {
    const root = await generatedProject("watch-flags");
    const code = await watchMain([
      "--project-root",
      root,
      "--once",
      "--framework",
      "express",
      "--framework-search-root",
      ".",
    ]);
    expect(code).toBe(0);
  });

  test("uses POSTMAN_PROJECT_ROOT as the implicit root", async () => {
    const root = await generatedProject("watch-env-root");
    previousRoot = process.env["POSTMAN_PROJECT_ROOT"];
    process.env["POSTMAN_PROJECT_ROOT"] = root;
    const code = await watchMain(["--once"]);
    expect(code).toBe(0);
  });

  test("rejects an invalid search root before regenerating", async () => {
    const root = await generatedProject("watch-invalid-search-root");
    const code = await watchMain([
      "--project-root",
      root,
      "--once",
      "--framework-search-root",
      "../outside",
    ]);
    expect(code).toBe(1);
  });
});
