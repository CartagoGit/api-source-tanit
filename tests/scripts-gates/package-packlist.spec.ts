import { expect, test } from "vitest";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PACKAGE_JSON } from "../../scripts/helpers/root.helper.js";
import { runProcess } from "../helpers/run-process.js";

test("npm package excludes Rust build outputs and keeps product files", async () => {
  const root = await mkdtemp(join(tmpdir(), "tanit-packlist-"));
  try {
    await copyFile(PACKAGE_JSON, join(root, "package.json"));
    await writeFile(join(root, ".gitignore"), "packages/desktop/target/\n");
    const files = [
      "packages/desktop/target/packlist-probe.txt",
      "packages/desktop/src/main.rs",
      "packages/core/probe.ts",
      "packages/app/dist/browser/index.html",
    ];
    for (const file of files) {
      const path = join(root, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "probe\n");
    }
    const { code, stdout, stderr } = await runProcess(
      "npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root },
    );
    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const packed = result[0]?.files.map((file) => file.path) ?? [];
    expect(packed).not.toContain(files[0]);
    for (const file of files.slice(1)) expect(packed).toContain(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
