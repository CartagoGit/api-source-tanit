#!/usr/bin/env bun
/**
 * `bun run ui:dev` — la interfaz, recargándose sola al editarla.
 *
 * `bun run ui` levanta la interfaz y ya. Para tocarla hay que pararla y
 * volver a lanzarla en cada cambio, y la página se sirve **desde
 * memoria** —`UI_HTML` es una constante compilada, no un fichero que el
 * servidor lea— así que ni siquiera recargar el navegador basta: hay
 * que reiniciar el proceso.
 *
 * Esto lo hace: vigila `projects/ui/`, `projects/cli/commands/ui.script.ts`
 * y los contratos que consumen, y reinicia el servidor cuando algo
 * cambia. El puerto se mantiene, así que la pestaña abierta sigue
 * valiendo — basta con recargar.
 *
 * ## Por qué no `bun --watch` a secas
 *
 * Porque `--watch` mata y relanza el proceso sin avisar, y el servidor
 * deja el puerto ocupado un instante: el relanzado encuentra el puerto
 * pillado y **se va al siguiente**, así que la pestaña abierta deja de
 * servir en cada guardado. Aquí se espera a que el puerto quede libre
 * antes de volver a arrancar.
 *
 * Uso:
 *   bun run ui:dev
 *   bun run ui:dev -- --port 5000
 */
import { watch } from "node:fs";
import { join } from "node:path";

import {
  CLI_COMMANDS_DIR,
  CONTRACTS_DIR,
  UI_DIR,
} from "../helpers/root.helper.js";
import { DEFAULT_UI_PORT } from "../../packages/contracts/constants/cli/terminal.constant.js";

/** Lo que se vigila. Cambiar cualquiera reinicia el servidor. */
const VIGILADO = [UI_DIR, join(CLI_COMMANDS_DIR, "ui.script.ts"), CONTRACTS_DIR];

/** Cuánto se espera tras un cambio antes de reiniciar. */
const REBOTE_MS = 250;

/** Cuánto se espera a que el puerto quede libre, y cada cuánto se mira. */
const PUERTO_LIBRE_MS = 3_000;
const SONDEO_MS = 50;

function puerto(argv: readonly string[]): number {
  const i = argv.indexOf("--port");
  const valor = i === -1 ? undefined : argv[i + 1];
  return valor ? Number(valor) : DEFAULT_UI_PORT;
}

/** ¿Sigue habiendo algo escuchando ahí? */
async function ocupado(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({ port, fetch: () => new Response("") });
    server.stop(true);
    return false;
  } catch {
    return true;
  }
}

async function esperarPuertoLibre(port: number): Promise<void> {
  const limite = Date.now() + PUERTO_LIBRE_MS;
  while (Date.now() < limite) {
    if (!(await ocupado(port))) return;
    await new Promise((r) => { setTimeout(() => r(undefined), SONDEO_MS); });
  }
  console.warn(
    `⚠ Port ${port} is still busy after ${PUERTO_LIBRE_MS}ms; starting anyway.`,
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const port = puerto(argv);
  const extra = argv.filter((a, i) => a !== "--port" && argv[i - 1] !== "--port");

  let hijo: ReturnType<typeof Bun.spawn> | null = null;
  let reiniciando = false;

  const arrancar = async (): Promise<void> => {
    await esperarPuertoLibre(port);
    hijo = Bun.spawn(
      [
        "bun",
        join(CLI_COMMANDS_DIR, "ui.script.ts"),
        "--no-open",
        "--port",
        String(port),
        ...extra,
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
  };

  const reiniciar = async (motivo: string): Promise<void> => {
    if (reiniciando) return;
    reiniciando = true;
    console.log(`\n↻ ${motivo} — restarting…`);
    hijo?.kill("SIGTERM");
    await hijo?.exited;
    await arrancar();
    reiniciando = false;
  };

  console.log("→ Dev server for the interface");
  console.log(`  · Watching: ${VIGILADO.map((v) => v.split("/").slice(-2).join("/")).join(", ")}`);
  console.log(`  · Port ${port} is kept across restarts: just reload the tab.`);
  console.log("  · Ctrl-C to stop.\n");

  await arrancar();

  let pendiente: ReturnType<typeof setTimeout> | null = null;
  for (const ruta of VIGILADO) {
    watch(ruta, { recursive: true }, (_evento, fichero) => {
      if (fichero && !fichero.endsWith(".ts")) return;
      if (pendiente) clearTimeout(pendiente);
      pendiente = setTimeout(() => void reiniciar(fichero ?? "change"), REBOTE_MS);
    });
  }

  // Cerrar el hijo al salir: sin esto queda un servidor huérfano
  // ocupando el puerto, y el siguiente `ui:dev` se va a otro.
  const despedirse = (): void => {
    hijo?.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", despedirse);
  process.on("SIGTERM", despedirse);

  await new Promise(() => {});
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
