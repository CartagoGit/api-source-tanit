#!/usr/bin/env bun
/**
 * `expostman ui` — la herramienta sin terminal.
 *
 * Levanta la interfaz en `localhost` y abre el navegador. Existe porque
 * la herramienta solo vivía en la línea de comandos, y eso deja fuera a
 * buena parte de quien prueba APIs — que es justo el público de Postman.
 *
 * No añade **ni una dependencia**: `Bun.serve` ya está en el runtime que
 * el binario lleva dentro, y la interfaz viaja embebida como texto. Es
 * lo que descartó Electron, que son 150 MB por plataforma para envolver
 * exactamente esto.
 *
 * Y no reimplementa nada: las rutas llaman al mismo pipeline que el CLI.
 * Una segunda implementación es una que se desincroniza.
 *
 * Uso:
 *   expostman ui
 *   expostman ui --port 5000
 *   expostman ui --no-open      # no abre el navegador, solo dice la URL
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

/** Abre el navegador, y si no puede, calla: la URL ya está impresa. */
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
    // Sin navegador, o sin entorno gráfico. La URL está impresa arriba.
  }
}

/**
 * Los colaboradores de la interfaz, atados al pipeline de verdad.
 *
 * `withScopedPaths` porque el servidor es de vida larga y el
 * descubrimiento de rutas cachea por proceso: sin esto, inspeccionar el
 * proyecto A y luego el B devolvería lo de A.
 */
function dependencias(catalogo: II18nCatalog): IUiDeps {
  return {
    // Se pasa ya cargado: leer la carpeta de idiomas en cada petición
    // sería releer quince ficheros por pulsación, y la carpeta solo
    // cambia entre arranques.
    locales: () => catalogo,
    // Los ajustes viven en un fichero de la carpeta de configuración: no
    // se pasan ya leídos porque cambian **mientras** la interfaz está
    // abierta, y una copia en memoria se quedaría vieja en cuanto otra
    // pestaña guardara algo.
    browse: (path) => browseDirectory(path),
    // El ensayo llama al pipeline de verdad —que construye en memoria—
    // y planifica desde su resultado. Predecir los nombres a mano sería
    // una segunda implementación que acabaría diciendo una cosa
    // mientras `generate` hace otra.
    dryRun: async ({ projectRoot, outputDir, formats, framework }) => {
      // `generateWithAllFrameworks` recibe la raíz por argumento y no
      // lee el singleton: sin contexto global que proteger, el
      // `withScopedPaths` de aquí solo añadía serialización.
      const result = await generateWithAllFrameworks(projectRoot, {
        ...(framework ? { forceFramework: framework } : {}),
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
    // Llama al **mismo** comando que usa la terminal, con sus flags. No
    // hay una segunda ruta de generación que pueda desincronizarse: si
    // `generate` cambia, la interfaz cambia con él.
    generate: async ({ projectRoot, outputDir, formats, framework }) => {
      const argv = ["--project-root", projectRoot];
      if (outputDir) argv.push("--output-dir", outputDir);
      if (formats && formats.length > 0) argv.push("--format", formats.join(","));
      // Forzar el framework se apoya en el flag que ya existe: se salta
      // la autodetección. La ruta ya fue validada contra el catálogo en
      // las rutas de la interfaz.
      if (framework) argv.push("--framework", framework);

      // El contexto va explícito (r00008 S2): `runGenerate` lo inyecta
      // en el pipeline y ninguna ruta lee `process.argv` del proceso.
      // Antes esto exigía `withScopedPaths`, que pisa y restaura estado
      // global — y dos peticiones concurrentes se lo destrozaban.
      const context = resolveProjectContext({
        projectRoot,
        ...(outputDir ? { outputDir } : {}),
      });
      const { code, report } = await runGenerate(argv, context);
      if (code !== 0 || !report) {
        throw new Error(
          "Generation did not finish. Check the terminal where you started `expostman ui`.",
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
     * Lee el historial compartido. No se inyecta `home` ni `env` porque
     * el servidor es de la persona que lo arranca: su carpeta es la que
     * tiene sentido. En un test el doble sustituye este método y la
     * ruta real queda sin ejercitar — es el contrato que
     * `tests/cli/ui-routes.spec.ts` ya prueba para el resto de
     * colaboradores.
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

  // Los idiomas se dejan en disco la primera vez y se recargan desde
  // ahí: es lo que hace que se puedan editar y que añadir uno sea dejar
  // un fichero. Si la carpeta no se puede escribir —permisos, un
  // sistema de solo lectura— se sigue con los empaquetados: quedarse sin
  // interfaz por no poder escribir una copia editable sería absurdo.
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

  // Sin esto el puerto se queda ocupado y hay que buscar el proceso a
  // mano, que en una herramienta con interfaz gráfica es lo último que
  // alguien espera tener que hacer.
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
