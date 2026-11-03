#!/usr/bin/env bun
/**
 * Opens the generated Postman collection in the system app.
 *
 * Cross-platform strategy (preference order):
 *   1. If `POSTMAN_FORCE_OPEN=web` → opens `https://app.postman.com/import`
 *      and shows the path to the JSON so it can be dragged in.
 *   2. macOS:   `open -a "Postman" <file>`   (and `xdg-open` fallback).
 *   3. Linux:   `xdg-open <file>`             (with `gio open` fallback).
 *   4. Windows: `start "" <file>`             via cmd.exe.
 *   5. If there is no desktop app → opens the web and shows the local path.
 *
 * Usage:
 *   bun run scripts/open-postman.script.ts
 *   bun run scripts/open-postman.script.ts --web
 *   bun run scripts/open-postman.script.ts --file <path>
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import { resolveOutputDir } from "../../core/discovery/output-paths.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";

const platform: string = process.platform ?? "linux";
void platform; // suppress unused warning; kept for clarity

export async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const forceWeb = args.includes("--web");
  const fileFlag = args.indexOf("--file");
  const explicitFile =
    fileFlag !== -1 ? args[fileFlag + 1] ?? null : null;

  // Explicit context (r00008 S1): as with the rest of commands, the
  // loader must not fall back to the singleton to figure out which project
  // it is.
  const resolvedContext = resolveProjectContext({ argv: args });
  const { config } = await loadProject(args, resolvedContext).catch(() => ({
    config: undefined,
  }));
  const projectName = config?.name;

  const collectionPath =
    explicitFile ??
    `${resolveOutputDir(resolvedContext)}/${projectName ?? "collection"}.postman_collection.json`;

  if (!existsSync(collectionPath)) {
    console.error(`✘ Not found: ${collectionPath}`);
    console.error(
      "  Run `generate` first (or pass --output <path>).",
    );
    return 1;
  }

  const os = platform;
  console.log(`→ Opening Postman with: ${collectionPath}`);
  console.log(`→ Platform: ${os}`);

  if (forceWeb) {
    return openWeb(collectionPath);
  }

  // 1) macOS: Postman.app
  if (os === "darwin") {
    const r = spawnSync("open", ["-a", "Postman", collectionPath], {
      stdio: "inherit",
    });
    if (r.status === 0) {
      console.log("✔ Postman.app opened.");
      return 0;
    }
    console.log("  · Postman.app not found, falling back to the generic `open`…");
    const r2 = spawnSync("open", [collectionPath], { stdio: "inherit" });
    if (r2.status === 0) {
      console.log("✔ Opened with the system default.");
      return 0;
    }
    return openWeb(collectionPath);
  }

  // 2) Windows: cmd /c start
  if (os === "win32") {
    const r = spawnSync("cmd", ["/c", "start", "", collectionPath], {
      stdio: "inherit",
    });
    if (r.status === 0) {
      console.log("✔ Apertura en Windows OK.");
      return 0;
    }
    return openWeb(collectionPath);
  }

  // 3) Linux: xdg-open → gio open → web
  if (os === "linux") {
    const r = spawnSync("xdg-open", [collectionPath], { stdio: "inherit" });
    if (r.status === 0) {
      console.log("✔ xdg-open OK.");
      return 0;
    }
    const r2 = spawnSync("gio", ["open", collectionPath], { stdio: "inherit" });
    if (r2.status === 0) {
      console.log("✔ gio open OK.");
      return 0;
    }
    return openWeb(collectionPath);
  }

  return openWeb(collectionPath);
}

function openWeb(filePath: string): number {
  const url = "https://app.postman.com/import";
  console.log("→ No desktop app detected; opening the web version…");
  console.log(`  ${url}`);
  console.log("");
  console.log("  Drag this file into the importer:");
  console.log(`    ${filePath}`);

  const os = platform;
  if (os === "darwin") {
    spawnSync("open", [url], { stdio: "inherit" });
  } else if (os === "win32") {
    spawnSync("cmd", ["/c", "start", "", url], { stdio: "inherit" });
  } else {
    spawnSync("xdg-open", [url], { stdio: "inherit" });
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
