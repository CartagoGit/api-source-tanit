import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { CLI_COMMANDS_DIR } from "../../scripts/helpers/root.helper.js";

function interfaceUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("The UI did not announce its loopback URL")), 15_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The UI exited with code ${code}`));
    });
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      const url = /Interface at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    });
  });
}

test("apisrc ui serves the compiled page and the shared Application API on one origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "tanit-ui-static-"));
  const assets = join(root, "assets");
  const project = join(root, "project");
  try {
    await mkdir(assets);
    await mkdir(project);
    await writeFile(join(assets, "index.html"), `<!doctype html><html>
      <link rel="stylesheet" href="styles.css">
      <script type="module" src="main.js"></script>
    </html>`);
    await writeFile(join(assets, "main.js"), "export {};");
    await writeFile(join(assets, "styles.css"), "body { color: black; }");
    await writeFile(join(project, "openapi.json"), JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Fixture", version: "1.0.0" },
      paths: { "/health": { get: { responses: { "200": { description: "OK" } } } } },
    }));

    const child = spawn("bun", [join(CLI_COMMANDS_DIR, "ui.script.ts"), "--no-open", "--static-dir", assets], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data") },
    });
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    try {
      const url = await interfaceUrl(child);
      const page = await fetch(url);
      expect(page.status).toBe(200);
      const policy = page.headers.get("content-security-policy");
      expect(policy).toContain("script-src 'self'");
      expect(policy).toContain("style-src 'self'");
      const token = /<html[^>]*data-tanit-token="([^"]+)"/.exec(await page.text())?.[1];
      expect(token).toBeTruthy();
      const [script, styles] = await Promise.all([fetch(`${url}/main.js`), fetch(`${url}/styles.css`)]);
      expect(script.headers.get("content-type")).toContain("text/javascript");
      expect(await script.text()).toBe("export {};");
      expect(styles.headers.get("content-type")).toContain("text/css");
      expect(await styles.text()).toBe("body { color: black; }");

      const payload = JSON.stringify({ jsonrpc: "2.0", id: "open", method: "open-project", params: { projectRoot: project } });
      const request = (origin: string, requestToken: string) => fetch(`${url}/api`, {
        method: "POST",
        headers: { origin, "x-tanit-token": requestToken, "content-type": "application/json" },
        body: payload,
      });
      expect((await request(url, "invalid")).status).toBe(403);
      expect((await request("http://example.invalid", token!)).status).toBe(403);
      const opened = await request(url, token!);
      expect(opened.status).toBe(200);
      expect(await opened.json()).toMatchObject({
        id: "open",
        result: { ok: true, value: { sessionId: expect.any(String), summary: { projectRoot: await realpath(project) } } },
      });
    } finally {
      child.kill("SIGTERM");
      await exited;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
