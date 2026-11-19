#!/usr/bin/env bun
/**
 * Compila el CLI a un ejecutable autocontenido por plataforma.
 *
 * Implementa p00010. El público de este paquete son equipos de PHP,
 * Python, Go, Java y .NET donde mucha gente no tiene un runtime de
 * JavaScript instalado. Pedirles que instalen Bun para exportar su API
 * a Postman es fricción evitable: el binario no necesita nada.
 *
 * Requisito: el CLI debe **importar** sus comandos, no spawnear
 * `bun run <script>`. Con spawn, el binario compilado fallaba con
 * `Module not found` porque dentro del ejecutable no hay ficheros.
 *
 * Uso:
 *   bun run build:binary              # solo la plataforma actual
 *   bun run build:binary --all        # todos los destinos
 *   bun run build:binary --out ./dist
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { arch as osArch } from "node:os";
import { join, resolve } from "node:path";
import { BIN_NAME } from "../../packages/contracts/constants/core/postman.constant.js";
import { hasFlag, readFlag } from "../../packages/core/helpers/argv.helper.js";
import { CLI_ENTRYPOINT, DIST_DIR, REPO_ROOT } from "../helpers/root.helper.js";

/** Targets de `bun build --compile`, con el sufijo del artefacto. */
const TARGETS: ReadonlyArray<{ readonly target: string; readonly suffix: string }> = [
  { target: "bun-linux-x64", suffix: "linux-x64" },
  { target: "bun-linux-arm64", suffix: "linux-arm64" },
  { target: "bun-darwin-x64", suffix: "darwin-x64" },
  { target: "bun-darwin-arm64", suffix: "darwin-arm64" },
  { target: "bun-windows-x64", suffix: "windows-x64.exe" },
];

function currentTarget(): (typeof TARGETS)[number] {
  const platform = process.platform;
  // `os.arch()` returns the same values Node and Bun both
  // understand (`x64`, `arm64`, `ia32`, ...). We use it because
  // Bun's `process.arch` typing is incomplete — `process.platform`
  // is fine, but `process.arch` is missing in the global namespace
  // for the Bun runtime.
  const arch = osArch();
  // macOS — Intel vs Apple Silicon must be distinguished by
  // `process.arch`, not just the platform. Without this branch an
  // Intel Mac would pick up the arm64 binary and silently fail at
  // boot (`Bad CPU type in executable`). Windows targets x64.
  const suffix =
    platform === "darwin"
      ? arch === "x64"
        ? "darwin-x64"
        : "darwin-arm64"
      : platform === "win32"
        ? "windows-x64.exe"
        : arch === "arm64" ? "linux-arm64" : "linux-x64";
  return TARGETS.find((t) => t.suffix === suffix) ?? TARGETS[0]!;
}

async function compile(
  target: string,
  outfile: string,
): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(
    ["bun", "build", "--compile", `--target=${target}`, CLI_ENTRYPOINT, "--outfile", outfile],
    { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { ok: (await proc.exited) === 0, output: stdout + stderr };
}

async function launchUi(
  outfile: string,
  outDir: string,
  target: (typeof TARGETS)[number],
  windowsInterop: boolean,
  port: string | undefined,
): Promise<number> {
  const angularDir = join(outDir, `angular-${target.target}`);
  const staticDir = join(angularDir, "browser");
  const uiDir = windowsInterop
    ? spawnSync("wslpath", ["-w", staticDir], { encoding: "utf8" })
    : undefined;
  if (uiDir && uiDir.status !== 0) {
    console.error(`No se pudo convertir la ruta para Windows: ${staticDir}`);
    return 1;
  }

  const app = Bun.spawn(
    ["bun", "run", "build:app", "--output-path", angularDir],
    { cwd: REPO_ROOT, stdout: "inherit", stderr: "inherit" },
  );
  if ((await app.exited) !== 0 || !existsSync(join(staticDir, "index.html"))) {
    console.error(`No se encontró el build de Angular: ${staticDir}`);
    return 1;
  }

  const nativeDir = uiDir ? uiDir.stdout.trim() : staticDir;
  const args = ["ui", "--no-open", "--static-dir", nativeDir];
  if (port !== undefined) args.push("--port", port);
  return Bun.spawn([outfile, ...args], {
    cwd: outDir,
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
}

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const all = argv.includes("--all");
  const ui = argv.includes("--ui");
  const name = readFlag(argv, "--target");
  const out = readFlag(argv, "--out");
  const port = readFlag(argv, "--port");
  const target = name ? TARGETS.find((entry) => entry.target === name) : currentTarget();
  if (!target || (all && (name || ui))
    || (hasFlag(argv, "--target") && !name)
    || (hasFlag(argv, "--out") && !out)
    || (hasFlag(argv, "--port") && !port)) {
    console.error("Uso: build:binary [--all | --target <target>] [--out <carpeta>] [--ui [--port <puerto>]]");
    return 1;
  }

  const windowsInterop = target.target === "bun-windows-x64"
    && process.platform === "linux"
    && Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
  if (ui && !windowsInterop && target.target !== currentTarget().target) {
    console.error("El ejecutable de la interfaz debe corresponder al sistema donde se ejecuta.");
    return 1;
  }
  const windowsDownloads = "/mnt/c/Users/Public/Downloads";
  const targetOut = windowsInterop && existsSync(windowsDownloads)
    ? join(windowsDownloads, "Tanit-dev")
    : join(REPO_ROOT, ".cache", "tanit", "binaries");
  const outDir = resolve(out ?? (name || ui ? targetOut : DIST_DIR));
  await mkdir(outDir, { recursive: true });
  const targets = all ? TARGETS : [target];
  console.log(`→ Compilando ${targets.length} binario(s) en ${outDir}\n`);

  let failed = 0;
  for (const entry of targets) {
    const filename = `${BIN_NAME}-${entry.suffix}`;
    const outfile = join(outDir, filename);
    const staging = await mkdtemp(join(outDir, ".apisrc-build-"));
    const staged = join(staging, filename);
    const started = Date.now();
    try {
      const result = await compile(entry.target, staged);
      if (!result.ok || !existsSync(staged)) {
        failed += 1;
        console.error(`  FAIL ${entry.suffix.padEnd(18)} ${result.output.trim().slice(-300)}`);
        continue;
      }
      await rename(staged, outfile);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const sizeMb = (Bun.file(outfile).size / 1024 / 1024).toFixed(0);
      console.log(`  ok   ${entry.suffix.padEnd(18)} ${sizeMb} MB   ${seconds}s`);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} binario(s) no se pudieron compilar.`);
    return 1;
  }
  console.log(`\n${targets.length} binario(s) listos en ${outDir}`);
  return ui
    ? launchUi(join(outDir, `${BIN_NAME}-${target.suffix}`), outDir, target, windowsInterop, port)
    : 0;
}

if (import.meta.main) {
  process.exit(await main());
}
