/**
 * An output path must not escape where it should stay.
 *
 * The CLI accepts `--output-dir` as-is, which is fine when a person
 * types it on their own machine. But the MCP plugin spawns this same
 * CLI with arguments that come from an agent, and there whoever picks
 * the path is no longer necessarily the person.
 *
 * The two classic failures of this check are covered below: the
 * symlink that points outside, and the string prefix that looks like
 * a parent without being one.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureInside } from "../../packages/core/helpers/path-containment.helper";

let base = "";
let raiz = "";

beforeEach(async () => {
  // `realpath` because on macOS `/tmp` is a symlink to `/private/tmp`,
  // so the declared root and the resolved root would never match.
  base = await realpath(await mkdtemp(join(tmpdir(), "contain-")));
  raiz = join(base, "raiz");
  await mkdir(raiz, { recursive: true });
});

afterEach(async () => {
  if (base) await rm(base, { recursive: true, force: true });
});

describe("what is inside", () => {
  test("the root itself", async () => {
    expect((await ensureInside(raiz, raiz)).ok).toBe(true);
  });

  test("a subfolder that exists", async () => {
    const sub = join(raiz, "salida");
    await mkdir(sub);
    expect((await ensureInside(raiz, sub)).ok).toBe(true);
  });

  /**
   * The normal case: the output folder **does not exist yet**, it is
   * about to be created. If the check required it to exist, it would
   * be worthless.
   */
  test("a subfolder that does not exist yet", async () => {
    expect((await ensureInside(raiz, join(raiz, "no", "existe", "aun"))).ok).toBe(true);
  });

  test("a relative path resolves against the root", async () => {
    expect((await ensureInside(raiz, "salida")).ok).toBe(true);
  });

  test("returns the already-resolved path, to write there", async () => {
    const r = await ensureInside(raiz, "salida");
    expect(r.resolved).toBe(join(raiz, "salida"));
  });
});

describe("what is outside", () => {
  test("a `../` that escapes", async () => {
    const r = await ensureInside(raiz, join(raiz, "..", "fuera"));
    expect(r.ok).toBe(false);
  });

  test("a foreign absolute path", async () => {
    expect((await ensureInside(raiz, join(base, "otra"))).ok).toBe(false);
  });

  test("says where it was heading, not just that it is not allowed", async () => {
    const r = await ensureInside(raiz, join(raiz, "..", "fuera"));
    expect(r.ok).toBe(false);
    // CLI output speaks English (lint:output-language); the `reason`
    // travels inside the `generate` message, so its language matches
    // the rest of the surface.
    if (!r.ok) expect(r.reason).toContain("is outside");
  });

  /**
   * THE classic failure: comparing string prefixes. `/base/raiz-mala`
   * starts with `/base/raiz` and is not inside it.
   */
  test("a sibling whose name starts the same as the root", async () => {
    const hermano = join(base, "raiz-mala");
    await mkdir(hermano);
    expect((await ensureInside(raiz, hermano)).ok).toBe(false);
  });

  /**
   * The other classic failure: a symlink **inside** the root that
   * points outside. Without resolving symlinks, this passes the check
   * and writes wherever it pleases.
   */
  test("a symlink inside the root that points outside", async () => {
    const fuera = join(base, "fuera");
    await mkdir(fuera);
    await writeFile(join(fuera, "marca.txt"), "x");
    const enlace = join(raiz, "puerta");
    await symlink(fuera, enlace);
    expect((await ensureInside(raiz, enlace)).ok).toBe(false);
    // Nor through it.
    expect((await ensureInside(raiz, join(enlace, "dentro"))).ok).toBe(false);
  });
});
