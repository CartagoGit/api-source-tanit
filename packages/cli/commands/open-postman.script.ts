#!/usr/bin/env bun
/** Open a generated collection with the system launcher, falling back to the web importer. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { hasFlag, readFlag } from "../../core/helpers/argv.helper.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import { resolveOutputDir } from "../../core/discovery/output-paths.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { OPEN_LAUNCH_GRACE_MS } from "../../contracts/constants/cli/open-postman.constant.js";
import type { IOpenPostmanOptions } from "../../contracts/interfaces/cli/open-postman.interface.js";

/** Observe immediate launcher failures, then release a still-running application. */
export function launchDetached(command: string, args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, [...args], { detached: true, stdio: "ignore" });
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.unref();
        resolve(ok);
      };
      child.once("error", () => finish(false));
      child.once("exit", (code) => finish(code === 0));
      child.once("spawn", () => {
        if (!settled) timer = setTimeout(() => finish(true), OPEN_LAUNCH_GRACE_MS);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Open the selected collection using explicit arguments and injectable host dependencies. */
export async function main(
  args: readonly string[] = process.argv.slice(2),
  options: IOpenPostmanOptions = {},
): Promise<number> {
  const resolvedContext = options.context ?? resolveProjectContext({ argv: args });
  const explicitFile = readFlag(args, "--file");
  const { config } = await loadProject(args, resolvedContext).catch(() => ({ config: undefined }));
  const collectionPath = explicitFile ??
    `${resolveOutputDir(resolvedContext)}/${config?.name ?? "collection"}.postman_collection.json`;
  if (!existsSync(collectionPath)) {
    console.error(`✘ Not found: ${collectionPath}`);
    console.error("  Run `generate` first (or pass --file <path>).");
    return 1;
  }

  const os = options.platform ?? process.platform;
  const launch = options.launch ?? launchDetached;
  console.log(`→ Opening Postman with: ${collectionPath}`);
  console.log(`→ Platform: ${os}`);
  if (!hasFlag(args, "--web")) {
    if (os === "darwin") {
      if (await launch("open", ["-a", "Postman", collectionPath]) || await launch("open", [collectionPath])) return 0;
    } else if (os === "win32") {
      if (await launch("cmd", ["/c", "start", "", collectionPath])) return 0;
    } else if (os === "linux") {
      if (await launch("xdg-open", [collectionPath]) || await launch("gio", ["open", collectionPath])) return 0;
    }
  }

  const url = "https://app.postman.com/import";
  console.log("→ Opening the web importer…");
  console.log(`  ${url}`);
  console.log(`  Drag this file into the importer: ${collectionPath}`);
  const opened = os === "darwin"
    ? await launch("open", [url])
    : os === "win32"
      ? await launch("cmd", ["/c", "start", "", url])
      : await launch("xdg-open", [url]);
  if (opened) return 0;
  console.error(`✘ Could not start a system launcher. Open ${url} and import ${collectionPath}.`);
  return 1;
}

if (import.meta.main) process.exit(await main());
