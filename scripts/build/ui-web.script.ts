#!/usr/bin/env bun
/**
 * `bun run ui:web` — the desktop app in the browser, against the real
 * backend.
 *
 * ## Why this exists
 *
 * The app is Angular and it runs inside Tauri. Debugging it means
 * recompiling Rust and reinstalling the desktop shell — a cycle of
 * minutes for a change that is usually a line of TypeScript. The
 * browser is the same app with the same connector; it only lacks the
 * Tauri carrier, and the connector already speaks both.
 *
 * So this serves the **compiled app** (`packages/app/dist`) and the
 * **same Application API** the desktop app talks to, on **one
 * origin**:
 *
 *   · The page asks for `POST /api` with a **relative** path. A
 *     relative path means "the origin that served me", so the API has
 *     to be on the same origin as the page. Two servers on two ports
 *     would make every call cross-origin — and the answer to that is
 *     either CORS or a token a third party could read.
 *   · The token is planted in the served HTML (`data-tanit-token` on
 *     the `<html>` element), which is the only place a third party
 *     cannot read it from. The app already looks for it there.
 *   · The Origin is checked, exactly as the bridge does for every
 *     other carrier.
 *
 * This is a **development** tool: it is not part of the distributed
 * binary, and it does not change what the desktop app is. It exists
 * so that "it works in the browser" means "it works in the app",
 * because both run the same connector over the same registry.
 *
 * Usage:
 *   bun run ui:web
 *   bun run ui:web -- --port 5200
 *   bun run ui:web -- --no-open
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { fromRoot } from "../helpers/root.helper.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { startHttpBridge } from "../../packages/core/transport/http-bridge.server.js";
import { defaultOrchestrator } from "../../packages/frameworks/index.js";
import { DEFAULT_UI_PORT } from "../../packages/contracts/constants/cli/terminal.constant.js";

/** Where the compiled app lands. */
const APP_DIST = fromRoot("packages", "app", "dist");

/** The port to try first. */
function puerto(argv: readonly string[]): number {
  const i = argv.indexOf("--port");
  const valor = i === -1 ? undefined : argv[i + 1];
  return valor ? Number(valor) : DEFAULT_UI_PORT;
}

/** Opens the browser, and stays quiet when it cannot. */
function abrirNavegador(url: string): void {
  const plataforma = process.platform;
  const cmd =
    plataforma === "darwin"
      ? ["open", url]
      : plataforma === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // No browser: the URL is already printed above.
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  if (!existsSync(join(APP_DIST, "index.html"))) {
    console.error(
      `\n✗ The app is not built.\n  · Expected ${APP_DIST}/index.html\n` +
        "  · Build it with: bun run build:app\n",
    );
    return 1;
  }

  const bridge = startHttpBridge({
    registry: buildRegistry(),
    port: puerto(argv),
    staticDir: APP_DIST,
    orchestrator: defaultOrchestrator(),
    caller: "browser",
  });

  console.log(`\n✔ App at ${bridge.url}`);
  console.log("  · The same Application API the desktop app talks to.");
  console.log("  · Listening on this machine only: not reachable from the network.");
  console.log("  · Ctrl-C to stop.\n");

  if (!argv.includes("--no-open")) abrirNavegador(bridge.url);

  await new Promise<void>((resolve) => {
    const cerrar = (): void => {
      console.log("\nShutting down.");
      bridge.stop();
      resolve();
    };
    process.once("SIGINT", cerrar);
    process.once("SIGTERM", cerrar);
  });
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
