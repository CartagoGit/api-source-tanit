/**
 * `packages/core/helpers/collection-file.helper.ts` — read the
 * collection from disk and explain why we cannot.
 *
 * Four commands — `list`, `stats`, `check` and `validate` — used to
 * call `readFile` directly and throw raw `ENOENT`s. The helper
 * consolidates the four cases that matter:
 *
 *   - The file does not exist (`ENOENT`) → next step is `generate`.
 *   - The file exists but cannot be read (permissions) → next step is
 *     to fix permissions.
 *   - The file is corrupt JSON → next step is to regenerate, because
 *     `atomic-write` is what guarantees the file is whole.
 *
 * Plus `explainReadFailure`, the printer that the four wrappers call
 * before returning 1.
 *
 * No spec covered this; the helpers were 0% in the measured coverage.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  explainReadFailure,
  readCollection,
} from "../../packages/core/helpers/collection-file.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "collection-file-helper-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

describe("readCollection — the four branches", () => {
  test("ENOENT returns the generate-it-first nextAction", async () => {
    const missing = join(work, "missing.json");
    const out = await readCollection(missing);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/No collection at/);
    expect(out.nextAction).toContain("Generate it first");
    expect(out.nextAction).toContain("apisrc generate");
  });

  test("permission denied returns the fix-permissions nextAction", async () => {
    const locked = join(work, "locked.json");
    await writeFile(locked, "{}");
    // Drop read perms on the file. The test runs in our own process
    // so we have permission to do that; reading it will then fail
    // with EACCES. We restore at the end so the cleanup works.
    await chmod(locked, 0o000);
    try {
      const out = await readCollection(locked);
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.reason).toMatch(/Could not read/);
      expect(out.nextAction).toContain("permissions");
    } finally {
      await chmod(locked, 0o600);
    }
  });

  test("JSON not parseable returns the regenerate-it nextAction", async () => {
    const corrupt = join(work, "corrupt.json");
    await writeFile(corrupt, "{not json");
    const out = await readCollection(corrupt);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/not valid JSON/);
    expect(out.nextAction).toContain("Generate it again");
  });

  test("ok:true when the file is valid JSON", async () => {
    const valid = join(work, "valid.json");
    await writeFile(valid, JSON.stringify({ info: { name: "x" } }));
    const out = await readCollection(valid);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.collection.info?.name).toBe("x");
  });
});

describe("explainReadFailure", () => {
  test("prints reason and nextAction lines and returns 1", async () => {
    const missing = join(work, "absent.json");
    const result = await readCollection(missing);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const logs: string[] = [];
    const savedErr = console.error;
    console.error = (...values: ReadonlyArray<unknown>): void => {
      for (const v of values) logs.push(String(v));
    };
    let code = 0;
    try {
      code = explainReadFailure(result);
    } finally {
      console.error = savedErr;
    }

    expect(code).toBe(1);
    const joined = logs.join("\n");
    expect(joined).toContain(result.reason);
    expect(joined).toContain("apisrc generate");
  });

  test("does not throw when the nextAction is empty", async () => {
    // Synthesize a minimal failure shape with empty nextAction to
    // verify the printer does not depend on non-empty text.
    const logs: string[] = [];
    const savedErr = console.error;
    console.error = (...values: ReadonlyArray<unknown>): void => {
      for (const v of values) logs.push(String(v));
    };
    let code = 0;
    try {
      code = explainReadFailure({
        ok: false,
        reason: "synthetic",
        nextAction: "",
      });
    } finally {
      console.error = savedErr;
    }
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("synthetic");
  });
});

describe("readCollection — a final sanity", () => {
  test("returned collection is the same content written to disk", async () => {
    const file = join(work, "roundtrip.json");
    const payload = { info: { name: "k", schema: "v2.1.0" }, item: [] };
    await writeFile(file, JSON.stringify(payload));
    const round = await readFile(file, "utf8");
    expect(round).toBe(JSON.stringify(payload));
    const out = await readCollection(file);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.collection).toEqual(payload);
  });
});