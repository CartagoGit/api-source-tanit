#!/usr/bin/env bun
/**
 * `bun run bench:scan` — cuánto tarda escanear, medido y no estimado.
 *
 * Existe porque p00033 pedía "una mejora ≥2×" sin haber medido nunca de
 * dónde venía el tiempo. Al medirlo salió que la lectura de ficheros es
 * el **19%** del pipeline: hacerla nueve veces más rápida deja el total
 * en 1,2×, no en 2×. El número que se prometía no era alcanzable, y sin
 * este script nadie lo habría sabido hasta después de tocar dieciocho
 * scanners.
 *
 * Los ejemplos del repo son demasiado pequeños para medir nada (de 2 a
 * 14 ficheros, ~25 ms), así que esto **genera** un proyecto sintético
 * del tamaño que se le pida y lo escanea.
 *
 * Uso:
 *   bun run bench:scan             # 125, 250, 500 y 1000 rutas
 *   bun run bench:scan 2000        # un tamaño concreto
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generateWithAllFrameworks } from "../../projects/frameworks/index.js";
import { collectFiles } from "../../projects/core/helpers/fs-walk.helper.js";
import { readAllFiles } from "../../projects/core/helpers/read-files.helper.js";

/** Tamaños por defecto: suficientes para ver si la curva es lineal. */
const DEFAULT_SIZES = [125, 250, 500, 1000] as const;

/**
 * Un proyecto Express con `routes` ficheros de rutas y otros tantos de
 * ruido.
 *
 * El ruido importa: un proyecto real no es solo rutas, y el coste de
 * abrir y descartar un fichero que no lo es forma parte de lo que se
 * mide.
 */
async function buildProject(root: string, routes: number): Promise<void> {
  await mkdir(join(root, "src", "routes"), { recursive: true });
  await mkdir(join(root, "src", "services"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "bench-api", dependencies: { express: "^4.18.0" } }, null, 2),
  );

  for (let i = 0; i < routes; i++) {
    await writeFile(
      join(root, "src", "routes", `resource${i}.route.js`),
      `import express from "express";\n` +
        `const router = express.Router();\n` +
        `router.get("/resource${i}", (req, res) => res.json([]));\n` +
        `router.get("/resource${i}/:id", (req, res) => res.json({}));\n` +
        `router.post("/resource${i}", (req, res) => res.json({}));\n` +
        `router.put("/resource${i}/:id", (req, res) => res.json({}));\n` +
        `router.delete("/resource${i}/:id", (req, res) => res.status(204).end());\n` +
        `export default router;\n`,
    );
    await writeFile(
      join(root, "src", "services", `service${i}.js`),
      `export function helper${i}(x) { return x * ${i}; }\n`.repeat(20),
    );
  }
}

/** Mediana de tres pasadas, tras una de calentamiento. */
async function timeScan(root: string): Promise<{ ms: number; specs: number }> {
  // La primera pasada paga la caché de disco: no cuenta.
  const warm = await generateWithAllFrameworks(root);
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    await generateWithAllFrameworks(root);
    runs.push(performance.now() - started);
  }
  runs.sort((a, b) => a - b);
  return { ms: runs[1] ?? 0, specs: warm.metrics.specs };
}

/** Cuánto de ese tiempo es leer del disco, y cuánto sería una a una. */
async function timeReads(root: string): Promise<{ parallel: number; sequential: number }> {
  const files = await collectFiles(root, (name) => name.endsWith(".js"));
  const { readFile } = await import("node:fs/promises");

  let started = performance.now();
  for (const file of files) await readFile(file, "utf8");
  const sequential = performance.now() - started;

  started = performance.now();
  await readAllFiles(files);
  const parallel = performance.now() - started;

  return { parallel, sequential };
}

async function main(): Promise<number> {
  const arg = process.argv[2];
  const sizes = arg ? [Number(arg)] : [...DEFAULT_SIZES];
  if (sizes.some((n) => !Number.isFinite(n) || n <= 0)) {
    console.error("bench:scan — el tamaño tiene que ser un número positivo");
    return 1;
  }

  const workDir = await mkdtemp(join(tmpdir(), "expostman-bench-"));
  try {
    console.log("bench:scan — proyecto Express sintético, mediana de 3 pasadas\n");
    console.log("  ficheros   specs      total    lectura(par)  lectura(seq)   µs/fichero");
    console.log("  ────────  ──────  ─────────  ────────────  ────────────  ───────────");

    for (const routes of sizes) {
      const root = join(workDir, `n${routes}`);
      await buildProject(root, routes);
      const { ms, specs } = await timeScan(root);
      const reads = await timeReads(root);
      const files = routes * 2;
      console.log(
        `  ${String(files).padStart(8)}  ${String(specs).padStart(6)}  ` +
          `${ms.toFixed(0).padStart(7)} ms  ` +
          `${reads.parallel.toFixed(0).padStart(9)} ms  ` +
          `${reads.sequential.toFixed(0).padStart(9)} ms  ` +
          `${((ms * 1000) / files).toFixed(0).padStart(10)}`,
      );
    }

    console.log(
      "\n  · `lectura(par)` es lo que cuesta hoy; `lectura(seq)` lo que costaba\n" +
        "    leyendo de una en una. La diferencia es la ganancia REAL del cambio,\n" +
        "    y el resto del `total` es parseo, donde el disco no pinta nada.\n" +
        "  · Si `µs/fichero` sube con el tamaño, hay algo cuadrático. Hoy es plano.",
    );
    return 0;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exit(await main());
}
