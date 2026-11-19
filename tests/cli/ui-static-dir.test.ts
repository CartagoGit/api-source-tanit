/**
 * `apisrc ui --static-dir` serves the compiled app.
 *
 * The desktop app is Angular and lands in `packages/app/dist`. When
 * it is there, `apisrc ui` serves it — the same interface the
 * desktop app shows, in a browser, over the same connector.
 *
 * The flag exists so that path is **explicit**: a test that depends
 * on whether somebody compiled the app is not a test, and a user who
 * wants to point the command at an app built somewhere else should
 * not have to move files around to do it.
 *
 * It runs as a subprocess, like `ui-server.test.ts` does: `Bun.serve`
 * only exists under Bun, and the whole command is what matters here.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR } from "../../scripts/helpers/root.helper";

/** A lightly used port, and the server looks for another if busy. */
const PORT = 4883;
const BASE = `http://127.0.0.1:${PORT}`;

let work = "";
let proceso: ChildProcess | null = null;

/** Waits for the server to answer, without sleeping blindly. */
async function esperarAlServidor(intentos = 60): Promise<void> {
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => { setTimeout(() => r(undefined), 250); });
  }
  throw new Error(`The interface did not respond at ${BASE} after ${intentos} attempts`);
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "ui-static-"));
  const dist = join(work, "app");
  await mkdir(dist, { recursive: true });
  await writeFile(
    join(dist, "index.html"),
    '<!doctype html><html lang="en"><body><tanit-root></tanit-root></body></html>',
    "utf8",
  );

  proceso = spawn(
    "bun",
    [
      join(CLI_COMMANDS_DIR, "ui.script.ts"),
      "--no-open",
      "--port",
      String(PORT),
      "--static-dir",
      dist,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await esperarAlServidor();
}, 180_000);

afterAll(async () => {
  proceso?.kill("SIGTERM");
  if (work) await rm(work, { recursive: true, force: true });
});

describe("the compiled app", () => {
  test("is the page that gets served", async () => {
    const html = await (await fetch(`${BASE}/`)).text();

    expect(html).toContain("<tanit-root>");
    expect(html).not.toContain("<title>Tanit</title>");
  });

  test("serves its own files too", async () => {
    await writeFile(join(work, "app", "styles.css"), "body{color:red}", "utf8");

    const res = await fetch(`${BASE}/styles.css`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("color:red");
  });
});
