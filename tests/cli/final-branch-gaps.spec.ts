/**
 * Last focused gaps for c00010 S3.
 *
 * This file covers argument fallbacks and environment behavior that are
 * structurally difficult to reach from the existing happy-path specs.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { URL } from "node:url";
import { generateWithAllFrameworks } from "../../packages/frameworks/index.js";
import { runPush } from "../../packages/cli/commands/push.script";
import { main as openPostman } from "../../packages/cli/commands/open-postman.script";
import { main as watchMain } from "../../packages/cli/commands/watch.script";

vi.mock("../../packages/frameworks/index.js", () => ({
  generateWithAllFrameworks: vi.fn(),
}));

let work = "";
let previousRoot: string | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(generateWithAllFrameworks).mockReset();
  if (previousRoot === undefined) delete process.env["POSTMAN_PROJECT_ROOT"];
  else process.env["POSTMAN_PROJECT_ROOT"] = previousRoot;
  if (work) await rm(work, { recursive: true, force: true });
  work = "";
});

async function project(name: string): Promise<string> {
  if (!work) work = await mkdtemp(join(tmpdir(), "cli-final-gaps-"));
  const root = join(work, name);
  await import("node:fs/promises").then((fs) => fs.mkdir(root, { recursive: true }));
  return root;
}

async function withArgv<T>(args: ReadonlyArray<string>, fn: () => Promise<T>): Promise<T> {
  const saved = [...process.argv];
  try {
    process.argv = ["node", "cli-final-gaps.spec.ts", ...args];
    return await fn();
  } finally {
    process.argv = saved;
  }
}

function fetchResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    json: async () => body,
  } as Awaited<ReturnType<typeof fetch>>;
}

describe("final CLI argument fallbacks", () => {
  test("watch falls back to cwd and accepts empty optional values", async () => {
    const code = await watchMain([
      "--once",
      "--framework",
      "--framework-search-root",
      "--debounce",
      "--format",
    ]);
    expect(code).toBe(1);
  });

  test("open-postman handles a --file flag without a value and failed discovery", async () => {
    const root = await project("open-file-fallback");
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(join(root, "tanit"), { recursive: true }),
    );
    await writeFile(join(root, "tanit", "open-file-fallback.postman_collection.json"), "{}");
    expect(await withArgv(
      ["--project-root", root, "--file"],
      () => openPostman(),
    )).toBe(0);
    expect(await withArgv(
      ["--project-root", root, "--config", join(root, "missing.config.ts")],
      () => openPostman(),
    )).toBe(1);
  });
});

describe("push environment and option branches", () => {
  test("uses default environments and custom generation flags without leaking uid", async () => {
    const root = await project("push-default-environments");
    const collection = {
      info: { name: "custom" },
      item: [{ name: "health", request: { method: "GET", header: [], url: { raw: "http://x/health", host: ["x"], path: ["/health"] } } }],
    };
    vi.mocked(generateWithAllFrameworks).mockResolvedValue({
      collection: collection as never,
      specs: [],
      config: { baseUrl: "http://x", variables: [], environments: null },
      match: { framework: "express" },
    } as unknown as Awaited<ReturnType<typeof generateWithAllFrameworks>>);
    vi.stubGlobal("fetch", (async (input: string | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/me") return fetchResponse(200, { user: { id: 1, username: "gap-user" } });
      if (pathname === "/collections") return fetchResponse(200, { collections: [], collection: {} });
      if (pathname === "/environments") return fetchResponse(200, { environments: [], environment: {} });
      return fetchResponse(404, { error: "not found" });
    }) as typeof fetch);

    const outcome = await runPush([
      "--project-root", root,
      "--api-key", "pmak-final-gaps",
      "--basename", "custom",
      "--framework", "express",
      "--framework-search-root", ".",
      "--workspace", "workspace-final-gaps",
    ]);
    expect(outcome.code).toBe(0);
    expect(outcome.environments).toHaveLength(4);
    expect(outcome.environments.every((item) => item.uid === "")).toBe(true);
    expect(outcome.collection?.uid).toBe("");
    expect(JSON.stringify(outcome)).not.toContain("pmak-final-gaps");
  });
});
