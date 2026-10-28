#!/usr/bin/env bun
/**
 * `bun run desktop:build` — los instaladores nativos.
 *
 * Compila el binario del CLI, lo coloca donde Tauri espera el sidecar, y
 * lanza el empaquetado. Los tres pasos van juntos a propósito: el
 * instalador **contiene** el binario, así que empaquetar sin recompilar
 * produce un instalador con una versión vieja dentro y nadie se entera
 * hasta que alguien lo instala.
 *
 * ## Una plataforma por ejecución, y solo la propia
 *
 * `desktop:build:linux`, `:mac` y `:windows` existen para nombrar lo que
 * sale, no para cruzar. **No se puede compilar el `.dmg` desde Linux**:
 * cada instalador exige el SDK de su sistema y su firma, y Tauri
 * enlaza contra las librerías nativas de la máquina. Pedir una
 * plataforma que no es la actual falla aquí, con el motivo escrito, en
 * vez de producir algo roto.
 *
 * Los tres a la vez los produce `.github/workflows/release-desktop.yml`,
 * con una máquina por plataforma. Es la única forma.
 *
 * ## Por qué el sufijo del triple
 *
 * Tauri busca `binaries/expostman-<target-triple>`, no
 * `binaries/expostman`. Sin el sufijo el empaquetado falla con un «no
 * such file» que apunta a una ruta que sí existe, que es de los errores
 * que más tiempo comen.
 */
import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, CLI_ENTRYPOINT } from "../helpers/root.helper.js";
import {
  DESKTOP_PLATFORMS,
  type IDesktopPlatform,
} from "../../packages/contracts/constants/cli/desktop.constant.js";

/** Dónde vive el proyecto de la ventana. */
const DESKTOP = join(REPO_ROOT, "packages", "desktop");

/** La plataforma que corresponde a esta máquina. */
function plataformaActual(): IDesktopPlatform | undefined {
  return DESKTOP_PLATFORMS.find((p) => p.platform === process.platform);
}

/**
 * El triple de Rust para esta máquina.
 *
 * Se pregunta a `rustc` en vez de deducirlo: la lista de triples es
 * larga y adivinarla es como se acaba con un instalador que no arranca
 * en la mitad de las máquinas.
 */
async function targetTriple(): Promise<string> {
  const proc = Bun.spawn(["rustc", "-vV"], { stdout: "pipe", stderr: "pipe" });
  const salida = await new Response(proc.stdout).text();
  await proc.exited;
  const linea = salida.split("\n").find((l) => l.startsWith("host:"));
  const triple = linea?.slice("host:".length).trim();
  if (!triple) {
    throw new Error(
      "Could not read the target triple from `rustc -vV`.\n" +
        "  · Is Rust installed? `bun run docker:installers` does not need it.",
    );
  }
  return triple;
}

async function ejecutar(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`\`${cmd.join(" ")}\` failed (exit ${code}).`);
  }
}

/**
 * Qué plataforma se ha pedido, y si esta máquina puede producirla.
 *
 * Sin `--platform` se construye la de la máquina. Con una que no es la
 * suya, se explica por qué no y qué hacer, en vez de intentarlo y dejar
 * un error de enlazado a 300 líneas de profundidad.
 */
function resolverPlataforma(argv: string[]): IDesktopPlatform {
  const actual = plataformaActual();
  const idx = argv.indexOf("--platform");
  const pedida = idx === -1 ? undefined : argv[idx + 1];

  if (!actual) {
    throw new Error(
      `Unsupported platform: ${process.platform}.\n` +
        `  · Installers can be produced on: ${DESKTOP_PLATFORMS.map((p) => p.id).join(", ")}.`,
    );
  }
  if (!pedida || pedida === actual.id) return actual;

  const objetivo = DESKTOP_PLATFORMS.find((p) => p.id === pedida);
  if (!objetivo) {
    throw new Error(
      `Unknown platform "${pedida}".\n` +
        `  · Valid ones: ${DESKTOP_PLATFORMS.map((p) => p.id).join(", ")}.`,
    );
  }
  throw new Error(
    `Cannot build ${objetivo.label} installers from ${actual.label}.\n` +
      `  · Every installer needs its own system SDK and signing, and Tauri\n` +
      `    links against the machine's native libraries. Cross-building here\n` +
      `    would produce something that does not run.\n` +
      `  · Build the three from CI: .github/workflows/release-desktop.yml\n` +
      `    runs one machine per platform.\n` +
      `  · On this machine: bun run desktop:build:${actual.id}`,
  );
}

async function main(): Promise<number> {
  try {
    const argv = process.argv.slice(2);
    const objetivo = resolverPlataforma(argv);
    const triple = await targetTriple();

    console.log(`→ Platform: ${objetivo.label}`);
    console.log(`→ Target:   ${triple}`);
    console.log(`→ Bundles:  ${objetivo.bundles.join(", ")}\n`);

    // 1. El binario del CLI, que es el sidecar.
    const binarios = join(DESKTOP, "binaries");
    await mkdir(binarios, { recursive: true });
    const sidecar = join(binarios, `expostman-${triple}`);

    console.log("→ Compiling the sidecar…");
    await ejecutar(
      ["bun", "build", "--compile", CLI_ENTRYPOINT, "--outfile", sidecar],
      REPO_ROOT,
    );

    if (!existsSync(sidecar)) {
      throw new Error(`The sidecar did not appear at ${sidecar}`);
    }

    // 2. El empaquetado.
    //
    // `EXPOSTMAN_BUNDLES` acota los formatos por encima de la
    // plataforma. El contenedor pide solo `deb`: el `.AppImage` lo monta
    // `linuxdeploy` con FUSE, y dentro de un contenedor falla incluso
    // dándole `/dev/fuse` y `SYS_ADMIN` —se probó—. El error que da,
    // `failed to run linuxdeploy`, no menciona FUSE por ninguna parte.
    const forzados = process.env["EXPOSTMAN_BUNDLES"];
    const bundles = forzados ?? objetivo.bundles.join(",");
    console.log(`\n→ Packaging with Tauri (${bundles})…`);
    await ejecutar(["cargo", "tauri", "build", "--bundles", bundles], DESKTOP);

    // 3. Decir qué ha salido, con su tamaño: un instalador de 2 KB es un
    //    instalador vacío, y sin mirarlo parece que todo fue bien.
    const targetDir = process.env["CARGO_TARGET_DIR"] ?? join(DESKTOP, "target");
    const bundle = join(targetDir, "release", "bundle");
    console.log("\n✔ Installers:");
    let encontrados = 0;
    for (const formato of await readdir(bundle).catch(() => [])) {
      for (const fichero of await readdir(join(bundle, formato)).catch(() => [])) {
        const ruta = join(bundle, formato, fichero);
        const { size } = await Bun.file(ruta);
        console.log(`  · ${fichero}  (${(size / 1024 / 1024).toFixed(1)} MB)`);
        encontrados++;
      }
    }
    if (encontrados === 0) {
      throw new Error(
        `Tauri reported success but produced nothing in ${bundle}.\n` +
          "  · That usually means the requested bundles do not apply to this\n" +
          "    platform. Check `bundle.targets` in projects/desktop/tauri.conf.json.",
      );
    }

    console.log(
      `\n  · The other platforms come from .github/workflows/release-desktop.yml,\n` +
        `    one runner each: every installer needs its own SDK and signing.`,
    );
    return 0;
  } catch (error) {
    console.error(`\n✗ ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
