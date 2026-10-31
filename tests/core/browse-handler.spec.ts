/**
 * The `browse` handler.
 *
 * ## Why it exists
 *
 * The desktop app needs a folder picker, and it reached for the
 * CLI's web interface over HTTP — to `/api/browse`, a route only
 * that interface served. In the browser carrier the route does not
 * exist; in the desktop carrier there is no HTTP at all. The folder
 * list was dead in both, and the client was not even injectable, so
 * the Home screen threw before it drew anything.
 *
 * The implementation moved into the core and this handler exposes
 * it, so every carrier reaches the same listing.
 */
import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { createBrowseHandler } from "../../packages/core/application-api/browse.handler.js";

describe("the browse handler", () => {
  test("is registered, so the connector can reach it", () => {
    const registry = buildRegistry();

    expect(registry["browse"]).toBeDefined();
  });

  test("lists the folders of a folder, and only folders", async () => {
    const root = await mkdtemp(join(tmpdir(), "browse-"));
    try {
      await mkdir(join(root, "alpha"));
      await mkdir(join(root, "beta"));
      const handler = createBrowseHandler();

      const answer = await handler.handle({ path: root }, { caller: "cli" });

      expect(answer.listing.ok).toBe(true);
      expect(answer.listing.path).toBe(root);
      expect(answer.listing.entries.map((entry) => entry.name)).toEqual(["alpha", "beta"]);
      expect(answer.listing.entries.every((entry) => entry.readable)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("says so when the folder cannot be read, instead of failing", async () => {
    const handler = createBrowseHandler();

    const answer = await handler.handle({ path: "/definitely/not/here" }, { caller: "cli" });

    expect(answer.listing.ok).toBe(false);
    expect(answer.listing.entries).toHaveLength(0);
    expect(answer.listing.reason).toContain("not a folder");
  });

  test("needs no session: it is about the machine, not about a project", async () => {
    const handler = createBrowseHandler();

    // No `projectRoot`, no session: the handler does not look one
    // up, because there is nothing open yet when the folder list is
    // being browsed.
    await expect(handler.handle({}, { caller: "desktop" })).resolves.toBeDefined();
  });
});
