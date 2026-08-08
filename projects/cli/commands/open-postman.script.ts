#!/usr/bin/env bun
/**
 * Abre la colección Postman generada en la app del sistema.
 *
 * Estrategia multiplataforma (orden de preferencia):
 *   1. Si `POSTMAN_FORCE_OPEN=web` → abre `https://app.postman.com/import`
 *      y muestra la ruta al JSON para arrastrarlo.
 *   2. macOS:   `open -a "Postman" <file>`   (y fallback `xdg-open`).
 *   3. Linux:   `xdg-open <file>`             (con fallback `gio open`).
 *   4. Windows: `start "" <file>`             vía cmd.exe.
 *   5. Si no hay app de escritorio → abre web y muestra ruta local.
 *
 * Uso:
 *   bun run scripts/open-postman.script.ts
 *   bun run scripts/open-postman.script.ts --web
 *   bun run scripts/open-postman.script.ts --file <path>
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import { outputDir } from "../../core/discovery/paths.service.js";

const platform: string = process.platform ?? "linux";
void platform; // suppress unused warning; kept for clarity

export async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const forceWeb = args.includes("--web");
  const fileFlag = args.indexOf("--file");
  const explicitFile =
    fileFlag !== -1 ? args[fileFlag + 1] ?? null : null;

  const { config } = await loadProject().catch(() => ({ config: undefined }));
  const projectName = config?.name;

  const collectionPath =
    explicitFile ??
    `${outputDir()}/${projectName ?? "collection"}.postman_collection.json`;

  if (!existsSync(collectionPath)) {
    console.error(`✘ No se encuentra: ${collectionPath}`);
    console.error(
      "  Ejecuta primero `bun run build` (o genera con --output <ruta>).",
    );
    return 1;
  }

  const os = platform;
  console.log(`→ Abriendo Postman con: ${collectionPath}`);
  console.log(`→ Plataforma: ${os}`);

  if (forceWeb) {
    return openWeb(collectionPath);
  }

  // 1) macOS: Postman.app
  if (os === "darwin") {
    const r = spawnSync("open", ["-a", "Postman", collectionPath], {
      stdio: "inherit",
    });
    if (r.status === 0) {
      console.log("✔ Postman.app abierto.");
      return 0;
    }
    console.log("  · Postman.app no encontrado, usando 'open' genérico…");
    const r2 = spawnSync("open", [collectionPath], { stdio: "inherit" });
    if (r2.status === 0) {
      console.log("✔ Apertura genérica OK.");
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
  console.log("→ No se detectó app de escritorio; abriendo web…");
  console.log(`  ${url}`);
  console.log("");
  console.log("  Arrastra este archivo al importador:");
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
