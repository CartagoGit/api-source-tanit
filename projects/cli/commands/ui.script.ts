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

import { summarizeWithAllFrameworks } from "../../frameworks/index.js";
import { runGenerate } from "./generate.script.js";
import { SUPPORTED_FRAMEWORKS } from "../../frameworks/framework.registry.js";
import { supportedFormats } from "../../core/exporters/export-registry.service.js";
import { withScopedPaths } from "../../core/discovery/paths.service.js";
import { hasFlag, readFlag } from "../../core/helpers/argv.helper.js";
import { startUiServer } from "../../ui/server/ui-server.service.js";
import { UI_HTML } from "../../ui/web/index.html.constant.js";
import type { IUiDeps } from "../../ui/server/ui-routes.service.js";

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
function dependencias(): IUiDeps {
  return {
    summarize: (projectRoot) =>
      withScopedPaths({ projectRoot }, () => summarizeWithAllFrameworks(projectRoot)),
    // Llama al **mismo** comando que usa la terminal, con sus flags. No
    // hay una segunda ruta de generación que pueda desincronizarse: si
    // `generate` cambia, la interfaz cambia con él.
    generate: async ({ projectRoot, outputDir, formats }) => {
      const argv = ["--project-root", projectRoot];
      if (outputDir) argv.push("--output-dir", outputDir);
      if (formats && formats.length > 0) argv.push("--format", formats.join(","));

      // `withScopedPaths` **no es opcional aquí**, y costó verlo: el
      // argv que se le pasa a `runGenerate` lo leen sus propios flags,
      // pero `paths.service` resuelve la raíz y la salida leyendo
      // `process.argv` del proceso — que en un servidor de vida larga es
      // el del `expostman ui`, no el de la petición.
      //
      // Sin esto, pedir la colección del proyecto A generaba la del
      // directorio desde el que se lanzó la interfaz. Se vio ejercitando
      // la API de verdad: devolvió una ruta dentro de este mismo
      // repositorio en vez de la del proyecto pedido.
      //
      // Es la deuda que r00005 viene a cerrar; mientras el singleton
      // exista, todo consumidor de vida larga necesita este envoltorio.
      const { code, report } = await withScopedPaths(
        { projectRoot, ...(outputDir ? { outputDir } : {}) },
        () => runGenerate(argv),
      );
      if (code !== 0 || !report) {
        throw new Error(
          "La generación no terminó bien. Mira la terminal desde la que lanzaste `expostman ui`.",
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
    formats: () => supportedFormats(),
    frameworks: () => SUPPORTED_FRAMEWORKS,
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

  let server;
  try {
    server = startUiServer({
      deps: dependencias(),
      html: UI_HTML,
      ...(puerto !== undefined ? { port: puerto } : {}),
    });
  } catch (error) {
    console.error(`\n✗ No se pudo levantar la interfaz.\n  · ${(error as Error).message}`);
    return 1;
  }

  console.log(`\n✔ Interfaz en ${server.url}`);
  console.log("  · Escucha solo en este equipo: no es alcanzable desde la red.");
  console.log("  · Ctrl-C para cerrar.\n");

  if (!hasFlag(argv, "--no-open")) abrirNavegador(server.url);

  // Sin esto el puerto se queda ocupado y hay que buscar el proceso a
  // mano, que en una herramienta con interfaz gráfica es lo último que
  // alguien espera tener que hacer.
  await new Promise<void>((resolve) => {
    const cerrar = (): void => {
      console.log("\nCerrando la interfaz.");
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
