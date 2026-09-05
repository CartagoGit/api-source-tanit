#!/usr/bin/env bun
/**
 * `apisrc ui` — the tool without a terminal.
 *
 * Brings up the interface on `localhost` and opens the browser. It
 * exists because the tool only used to live on the command line, and
 * that leaves out a large part of the audience that tries APIs — which
 * is precisely Postman's audience.
 *
 * It adds **not a single dependency**: `Bun.serve` is already in the
 * runtime the binary ships with, and the interface travels embedded as
 * text. That is what ruled out Electron, which is 150 MB per platform
 * to wrap exactly this.
 *
 * And it does not reimplement anything: the routes call the same
 * pipeline as the CLI. A second implementation is one that drifts out
 * of sync.
 *
 * Usage:
 *   apisrc ui
 *   apisrc ui --port 5000
 *   apisrc ui --no-open      # does not open the browser, only prints the URL
 */
import { stat } from "node:fs/promises";

import {
  generateWithAllFrameworks,
  summarizeWithAllFrameworks,
} from "../../frameworks/index.js";
import { runGenerate } from "./generate.script.js";

import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { hasFlag, readFlag } from "../../core/helpers/argv.helper.js";
import { startUiServer } from "../../ui/server/ui-server.service.js";
import { UI_HTML } from "../../ui/web/index.html.constant.js";

import { FRAMEWORK_IDS } from "../../contracts/constants/frameworks/framework-ids.constant.js";
import type { IUiDeps } from "../../contracts/interfaces/cli/ui.interface.js";
import type { II18nCatalog } from "../../contracts/interfaces/cli/i18n.interface.js";
import { loadLocales, seedLocales } from "../../ui/i18n/i18n.service.js";
import { userLocalesDir } from "../../ui/config-dir.helper.js";
import { patchSettings, readSettings } from "../../ui/settings/settings.service.js";
import { browseDirectory } from "../../ui/server/browse.service.js";
import { planDryRun } from "../../ui/server/dry-run.service.js";
import { readHistory } from "../../ui/server/history.service.js";
import { EXPORT_FORMATS } from "../../contracts/constants/core/export-formats.constant.js";

/** Opens the browser, and if it cannot, stays quiet: the URL is already printed. */
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
    // No browser, or no graphical environment. The URL is already printed above.
  }
}

/**
 * The interface's collaborators, wired to the real pipeline.
 *
 * `withScopedPaths` because the server is long-lived and route
 * discovery caches per process: without this, inspecting project A and
 * then project B would return A's results.
 */
function dependencias(catalogo: II18nCatalog): IUiDeps {
  return {
    // It is passed in already loaded: reading the languages folder on
    // every request would mean rereading fifteen files per click, and
    // the folder only changes between startups.
    locales: () => catalogo,
    // Settings live in a file inside the configuration folder: they are
    // not passed in pre-read because they change **while** the
    // interface is open, and an in-memory copy would go stale as soon
    // as another tab saved something.
    browse: (path) => browseDirectory(path),
    // The dry run calls the real pipeline —which builds in memory— and
    // plans from its output. Predicting the names by hand would be a
    // second implementation that would end up saying one thing while
    // `generate` does another.
    dryRun: async ({ projectRoot, outputDir, formats, framework, frameworkSearchRoot }) => {
      // `generateWithAllFrameworks` receives the root as an argument and
      // does not read the singleton: with no global context to protect,
      // the `withScopedPaths` here only added serialization.
      const result = await generateWithAllFrameworks(projectRoot, {
        ...(framework ? { forceFramework: framework } : {}),
        ...(frameworkSearchRoot ? { frameworkSearchRoot } : {}),
      });
      return planDryRun({
        projectRoot,
        ...(outputDir ? { outputDir } : {}),
        ...(formats ? { formats } : {}),
        result,
      });
    },
    readSettings: () => readSettings(),
    patchSettings: (cambios) => patchSettings(cambios),
    summarize: (projectRoot) => summarizeWithAllFrameworks(projectRoot),
    // It calls the **same** command used by the terminal, with its flags.
    // There is no second generation path that can drift out of sync: if
    // `generate` changes, the interface changes with it.
    generate: async ({ projectRoot, outputDir, formats, framework, frameworkSearchRoot }) => {
      const argv = ["--project-root", projectRoot];
      if (outputDir) argv.push("--output-dir", outputDir);
      if (formats && formats.length > 0) argv.push("--format", formats.join(","));
      // Forcing the framework rides on the flag that already exists: it
      // skips autodetection. The path has already been validated against
      // the catalog in the interface routes.
      if (framework) argv.push("--framework", framework);
      // `--framework-search-root` is hung off the CLI the same way: the
      // flag already exists and `runGenerate` reads it. Subdir
      // validation lives in the pipeline, not in the UI; it is passed
      // here as-is.
      if (frameworkSearchRoot) argv.push("--framework-search-root", frameworkSearchRoot);

      // The context is explicit (r00008 S2): `runGenerate` injects it
      // into the pipeline and no route reads the process `process.argv`.
      // Previously this required `withScopedPaths`, which stomps on
      // global state and restores it — and two concurrent requests
      // would trample each other.
      const context = resolveProjectContext({
        projectRoot,
        ...(outputDir ? { outputDir } : {}),
      });
      const { code, report } = await runGenerate(argv, context);
      if (code !== 0 || !report) {
        throw new Error(
          "Generation did not finish. Check the terminal where you started `apisrc ui`.",
        );
      }
      return {
        collectionPath: report.collectionPath,
        requests: report.requests,
        folders: report.folders,
        extraPaths: report.extraPaths,
        warnings: report.warnings,
      };
    },
    formats: () => EXPORT_FORMATS,
    frameworks: () => FRAMEWORK_IDS,
    /**
     * Reads the shared history. Neither `home` nor `env` is injected
     * because the server belongs to the person running it: their
     * folder is the one that makes sense. In a test the double
     * substitutes this method and the real path goes unexercised — that
     * is the contract `tests/cli/ui-routes.spec.ts` already verifies
     * for the rest of the collaborators.
     */
    history: ({ limit, projectRoot }) =>
      readHistory({
        ...(limit !== undefined ? { limit } : {}),
        ...(projectRoot !== undefined ? { projectRoot } : {}),
      }),
    exists: async (path) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const puertoTexto = readFlag(argv, "--port");
  const puerto = puertoTexto === undefined ? undefined : Number(puertoTexto);
  if (puerto !== undefined && (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535)) {
    console.error("`--port` espera un número entre 1 y 65535.");
    return 1;
  }

  // Languages are seeded to disk the first time and reloaded from there:
  // that is what makes them editable and what makes adding one as easy
  // as dropping in a file. If the folder cannot be written —permissions,
  // a read-only system— it falls back to the bundled ones: losing the
  // interface because an editable copy could not be written would be
  // absurd.
  const carpetaIdiomas = userLocalesDir();
  try {
    await seedLocales(carpetaIdiomas);
  } catch (error) {
    console.warn(
      `⚠ Could not write the languages folder (${carpetaIdiomas}).\n` +
        `  · ${(error as Error).message}\n` +
        "  · The bundled languages still work; you just cannot edit them.",
    );
  }
  const catalogo = await loadLocales(carpetaIdiomas);
  for (const roto of catalogo.rejected) {
    console.warn(`⚠ Language file ${roto.file} was ignored: ${roto.reason}`);
  }

  let server;
  try {
    server = startUiServer({
      deps: dependencias(catalogo),
      html: UI_HTML,
      ...(puerto !== undefined ? { port: puerto } : {}),
    });
  } catch (error) {
    console.error(`\n✗ Could not start the interface.\n  · ${(error as Error).message}`);
    return 1;
  }

  console.log(`\n✔ Interface at ${server.url}`);
  console.log("  · Listening on this machine only: not reachable from the network.");
  console.log("  · Ctrl-C to stop.\n");

  if (!hasFlag(argv, "--no-open")) abrirNavegador(server.url);

  // Without this the port stays occupied and the process has to be
  // hunted down by hand, which in a GUI tool is the last thing anyone
  // expects to have to do.
  await new Promise<void>((resolve) => {
    const cerrar = (): void => {
      console.log("\nShutting the interface down.");
      server.stop();
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
