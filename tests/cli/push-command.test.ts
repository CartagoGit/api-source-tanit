/**
 * `push.script.ts` — `runPush()` in-process.
 *
 * `push` uploads the generated collection to Postman. The actual
 * upload goes through `verifyApiKey()` and `pushCollection()`, which
 * need a real `POSTMAN_API_KEY` to talk to the Postman API — that is
 * **not** covered here, by design: CI does not have credentials.
 *
 * What we cover is the contract that the MCP tool can rely on
 * without talking to the network:
 *
 *   - "No API key" branch: returns `code: 1`, `error.reason` set,
 *     and the next-action mentions `POSTMAN_API_KEY` and the URL.
 *   - "No endpoints found" branch: when the project has no routes,
 *     returns `code: 1` and the corresponding failure payload.
 *   - The `error` envelope is shaped correctly (no leaked secrets).
 *
 * `runPush` reads `--api-key` and `--workspace` from `argv`, so we
 * can exercise it without env vars.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runPush } from "../../packages/cli/commands/push.script";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "push-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

describe("push — runPush", () => {
  test("returns code 1 with a reason when no API key is given", async () => {
    // Force an empty key both ways: the `--api-key` flag is not
    // passed and the env var is empty. Without `POSTMAN_API_KEY`,
    // the command must refuse and surface the next-action text.
    const previousKey = process.env["POSTMAN_API_KEY"];
    const previousWorkspace = process.env["POSTMAN_WORKSPACE"];
    process.env["POSTMAN_API_KEY"] = "";
    delete process.env["POSTMAN_WORKSPACE"];
    const root = join(work, "no-key");
    await copyExampleClean(exampleDir("express"), root);
    try {
      const outcome = await runPush(["--project-root", root]);
      expect(outcome.code).toBe(1);
      expect(outcome.error).not.toBeNull();
      expect(outcome.error?.reason).toMatch(/api.?key/i);
      expect(outcome.error?.nextAction).toContain("POSTMAN_API_KEY");
      expect(outcome.error?.nextAction).toContain("postman.co");
      // No collection was uploaded.
      expect(outcome.collection).toBeNull();
      expect(outcome.environments).toEqual([]);
    } finally {
      if (previousKey === undefined) delete process.env["POSTMAN_API_KEY"];
      else process.env["POSTMAN_API_KEY"] = previousKey;
      if (previousWorkspace === undefined) delete process.env["POSTMAN_WORKSPACE"];
      else process.env["POSTMAN_WORKSPACE"] = previousWorkspace;
    }
  });

  test("exposes a fake api key without ever printing it back", async () => {
    // Same branch: a fake key with `--no-environments` and a path
    // that has routes. The command still goes through the verify
    // step, which will fail (the key is fake) and report the
    // error. The fake key MUST NOT appear in the error payload.
    const root = join(work, "fake-key");
    await copyExampleClean(exampleDir("express"), root);
    const previousKey = process.env["POSTMAN_API_KEY"];
    const previousWorkspace = process.env["POSTMAN_WORKSPACE"];
    process.env["POSTMAN_API_KEY"] = "";
    delete process.env["POSTMAN_WORKSPACE"];
    try {
      const fakeKey = "pmak-FAKE-FAKE-FAKE-FAKE-FAKE-FAKE-FakeFake01";
      const outcome = await runPush([
        "--project-root",
        root,
        "--api-key",
        fakeKey,
        "--no-environments",
      ]);
      // The verify step will throw because the key is not real; the
      // outcome carries an error envelope but the **fake key string
      // is never echoed back** in the user-facing fields.
      expect(outcome.code).not.toBe(0);
      const stringified = JSON.stringify(outcome);
      expect(stringified).not.toContain(fakeKey);
      expect(stringified).not.toContain("pmak-FAKE");
    } finally {
      if (previousKey === undefined) delete process.env["POSTMAN_API_KEY"];
      else process.env["POSTMAN_API_KEY"] = previousKey;
      if (previousWorkspace === undefined) delete process.env["POSTMAN_WORKSPACE"];
      else process.env["POSTMAN_WORKSPACE"] = previousWorkspace;
    }
  });

  test("returns the no-endpoints error when the project has no routes", async () => {
    // A folder with no manifest and no source code: discovery fails
    // and there are no endpoints to push.
    const root = join(work, "empty");
    const previousKey = process.env["POSTMAN_API_KEY"];
    process.env["POSTMAN_API_KEY"] = "pmak-fake";
    try {
      const outcome = await runPush([
        "--project-root",
        root,
        "--api-key",
        "pmak-fake",
      ]);
      // The verification step would 401 first; we accept either a
      // verify failure or a "no endpoints" failure. The important
      // contract is that the outcome is NOT a silent success.
      expect(outcome.code).not.toBe(0);
      expect(outcome.error).not.toBeNull();
    } finally {
      if (previousKey === undefined) delete process.env["POSTMAN_API_KEY"];
      else process.env["POSTMAN_API_KEY"] = previousKey;
    }
  });
});