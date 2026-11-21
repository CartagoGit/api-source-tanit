#!/usr/bin/env bun
/** Serve Angular from source with live reload and the local Application API. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { startHttpBridge } from "../../packages/core/transport/http-bridge.server.js";
import { defaultOrchestrator } from "../../packages/frameworks/index.js";
import { DEFAULT_UI_PORT } from "../../packages/contracts/constants/cli/terminal.constant.js";
import { fromRoot, REPO_ROOT } from "../helpers/root.helper.js";

async function main(argv: readonly string[]): Promise<number> {
  const portIndex = argv.indexOf("--port");
  const port = portIndex === -1 ? DEFAULT_UI_PORT : Number(argv[portIndex + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error("Provide a port between 1024 and 65535 with --port.");
    return 1;
  }

  const directory = await mkdtemp(join(tmpdir(), "tanit-ui-dev-"));
  try {
    const bridge = startHttpBridge({
      registry: buildRegistry(),
      orchestrator: defaultOrchestrator(),
      browserOrigin: `http://127.0.0.1:${port}`,
    });
    try {
      const proxyConfig = join(directory, "proxy.json");
      const proxy = { target: bridge.url };
      await Bun.write(proxyConfig, JSON.stringify({ "/api": proxy, "/api/**": proxy }));

      const command = [
        "node",
        fromRoot("node_modules", "@angular", "cli", "bin", "ng.js"),
        "serve", "tanit-app",
        "--host", "127.0.0.1", "--port", String(port),
        "--proxy-config", proxyConfig,
        ...(argv.includes("--no-open") ? [] : ["--open"]),
      ];
      const angular = Bun.spawn(command, {
        cwd: REPO_ROOT,
        stdout: "inherit",
        stderr: "inherit",
      });
      const stop = (): void => { angular.kill("SIGTERM"); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      return await angular.exited;
    } finally {
      bridge.stop();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
