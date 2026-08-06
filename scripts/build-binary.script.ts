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
 *   bun run build:binary --all        # las cuatro
 *   bun run build:binary --out ./dist
 */
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { moduleDir } from "../helpers/module-path.helper.js";

const PACKAGE_ROOT = resolve(moduleDir(import.meta.url), "..");
const ENTRYPOINT = join(PACKAGE_ROOT, "scripts", "cli.script.ts");

/** Targets de `bun build --compile`, con el sufijo del artefacto. */
const TARGETS: ReadonlyArray<{ readonly target: string; readonly suffix: string }> = [
  { target: "bun-linux-x64", suffix: "linux-x64" },
  { target: "bun-linux-arm64", suffix: "linux-arm64" },
  { target: "bun-darwin-arm64", suffix: "darwin-arm64" },
  { target: "bun-windows-x64", suffix: "windows-x64.exe" },
];

function currentTarget(): (typeof TARGETS)[number] {
  const platform = process.platform;
  const suffix =
    platform === "darwin"
      ? "darwin-arm64"
      : platform === "win32"
        ? "windows-x64.exe"
        : "linux-x64";
  return TARGETS.find((t) => t.suffix === suffix) ?? TARGETS[0]!;
}

async function compile(
  target: string,
  outfile: string,
): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(
    ["bun", "build", "--compile", `--target=${target}`, ENTRYPOINT, "--outfile", outfile],
    { cwd: PACKAGE_ROOT, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { ok: (await proc.exited) === 0, output: stdout + stderr };
}

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const all = argv.includes("--all");
  const outIdx = argv.indexOf("--out");
  const outDir = resolve(
    outIdx !== -1 && argv[outIdx + 1] ? argv[outIdx + 1]! : join(PACKAGE_ROOT, "dist"),
  );

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const targets = all ? TARGETS : [currentTarget()];
  console.log(`→ Compilando ${targets.length} binario(s) en ${outDir}\n`);

  let failed = 0;
  for (const { target, suffix } of targets) {
    const outfile = join(outDir, `postman-from-routes-${suffix}`);
    const started = Date.now();
    const result = await compile(target, outfile);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    if (!result.ok || !existsSync(outfile)) {
      failed += 1;
      console.error(`  FAIL ${suffix.padEnd(18)} ${result.output.trim().slice(-300)}`);
      continue;
    }
    const sizeMb = (Bun.file(outfile).size / 1024 / 1024).toFixed(0);
    console.log(`  ok   ${suffix.padEnd(18)} ${sizeMb} MB   ${seconds}s`);
  }

  if (failed > 0) {
    console.error(`\n${failed} binario(s) no se pudieron compilar.`);
    return 1;
  }
  console.log(`\n${targets.length} binario(s) listos en ${outDir}`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
