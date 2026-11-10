import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { staticAsset } from "../../packages/ui/server/ui-server.service.js";

const tempRoot = "/tmp/tanit-ui-static-assets";

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("compiled UI static serving", () => {
  it("serves the Angular index and assets with a request token", async () => {
    await mkdir(tempRoot, { recursive: true });
    await writeFile(join(tempRoot, "index.html"), '<script type="module" src="main.js"></script>');
    await writeFile(join(tempRoot, "main.js"), "console.log('tanit');");

    const index = await staticAsset(tempRoot, "/", "test-token");
    expect(index).not.toBeNull();
    const html = await index!.text();

    expect(index!.status).toBe(200);
    expect(index!.headers.get("content-type")).toContain("text/html");
    expect(html).toContain('data-token="test-token"');
    expect(html).toContain('src="main.js"');

    const asset = await staticAsset(tempRoot, "/main.js", "test-token");
    expect(asset).not.toBeNull();
    expect(asset!.status).toBe(200);
    expect(asset!.headers.get("content-type")).toContain("text/javascript");
    expect(await asset!.text()).toContain("tanit");

    const traversal = await staticAsset(tempRoot, "/../../package.json", "test-token");
    expect(traversal).not.toBeNull();
    expect(traversal!.status).toBe(404);
  });
});
