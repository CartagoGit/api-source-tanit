#!/usr/bin/env bun
/**
 * `tests/core/module-resolution.bench.ts` — r00020 S1 perf budget.
 *
 * Measures how long it takes to resolve **1000 imports** with the
 * `ModuleResolver`.
 *
 * The input is a synthetic project with 250 modules and 200
 * importers, each importer importing 5 modules (1000 imports in
 * total). Half of the imports go through a `tsconfig` alias and half
 * are relative, which is the mix a real project has.
 *
 * Two numbers are printed:
 *
 *   - **cold**: the first pass. The manifests and the `tsconfig` are
 *     already read (the resolver reads them when it is built — that
 *     is boot-time work), and this pass does the real resolution:
 *     1000 distinct specifiers, each one probed on disk.
 *   - **warm**: the second pass, with every resolution cached.
 *
 * The budget is **100 ms** for the cold pass. It is the number that
 * matters: the warm pass only proves that the cache works.
 *
 * ## Por qué se mide la mejor de varias pasadas
 *
 * Una pasada fría es una medición de la suerte del planificador. Si la
 * máquina está ocupada —otro proceso compilando, otro agente
 * publicando— la pasada tarda el doble o el triple y el gate falla,
 * aunque el resolutor no haya cambiado ni un milisegundo. Lo que
 * pasó: en una máquina con otra carga de trabajo, la validación de
 * `delendai work publish` —que exige que la validación pase— falló
 * dos veces seguidas por este bench (111 ms y 211 ms), sin que detrás
 * hubiera ningún cambio de código. Con la máquina quieta, la misma
 * pasada da 44-48 ms.
 *
 * Así que el presupuesto se compara con la **mejor** de varias pasadas
 * frías, cada una con su propio resolutor para que ninguna caché
 * falsee la medición. La mejor es lo más cerca que se puede estar de
 * «de qué es capaz el resolutor cuando la máquina no está peleando
 * por la CPU». El presupuesto no se toca: cambia lo que se mide, no
 * el límite.
 *
 * Usage:
 *
 *   bun run tests/core/module-resolution.bench.ts          # human-readable
 *   bun run tests/core/module-resolution.bench.ts --check   # gate: exits 1 on regression
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ModuleResolver } from "../../packages/core/module-resolution/resolver.service.js";

/** How many imports the benchmark resolves. */
const IMPORT_COUNT = 1000;

/** The budget for the cold pass, in milliseconds. */
const BUDGET_MS = 100;

/**
 * How many cold passes are measured.
 *
 * The budget is compared against the **best** of them: one single
 * pass measures the scheduler's luck, and the luck is not what the
 * budget is about.
 */
const COLD_PASSES = 5;

/** One import of the synthetic project. */
interface ISyntheticImport {
  readonly specifier: string;
  readonly fromFile: string;
}

/**
 * Builds the synthetic project and returns the imports to resolve.
 *
 * The same input every run: the numbers are comparable, and a
 * regression is a change in the resolver, not in the fixture.
 */
function buildProject(root: string): ReadonlyArray<ISyntheticImport> {
  mkdirSync(join(root, "src", "modules"), { recursive: true });
  mkdirSync(join(root, "src", "importers"), { recursive: true });

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      { name: "bench-module-resolution", version: "1.0.0" },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/modules/*"] },
        },
      },
      null,
      2,
    ),
  );

  const moduleCount = 250;
  for (let i = 0; i < moduleCount; i++) {
    writeFileSync(
      join(root, "src", "modules", `module${i}.ts`),
      `export const value${i} = ${i};\n`,
    );
  }

  const imports: ISyntheticImport[] = [];
  const importerCount = Math.ceil(IMPORT_COUNT / 5);
  for (let i = 0; i < importerCount; i++) {
    const fromFile = join(root, "src", "importers", `importer${i}.ts`);
    const lines: string[] = [];
    for (let j = 0; j < 5; j++) {
      const target = (i * 5 + j) % moduleCount;
      const specifier =
        j % 2 === 0 ? `@/module${target}` : `./../modules/module${target}`;
      lines.push(`import { value${target} } from "${specifier}";`);
      imports.push({ specifier, fromFile });
    }
    writeFileSync(fromFile, `${lines.join("\n")}\n`);
  }
  return imports;
}

/** Resolves every import once and returns how many were resolved. */
function resolveAll(
  resolver: ModuleResolver,
  imports: ReadonlyArray<ISyntheticImport>,
): number {
  let resolved = 0;
  for (const item of imports) {
    const outcome = resolver.resolve(item.specifier, item.fromFile);
    if (outcome.ok) resolved++;
  }
  return resolved;
}

async function main(): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), "bench-module-resolution-"));
  try {
    const imports = buildProject(root);

    // Cada pasada fría con su propio resolutor: si compartieran
    // resolver, la segunda pasada mediría la caché y no el disco.
    const coldTimes: number[] = [];
    let coldResolved = 0;
    let resolver: ModuleResolver | undefined;
    for (let pass = 0; pass < COLD_PASSES; pass += 1) {
      resolver = new ModuleResolver({ projectRoot: root });
      const started = performance.now();
      const resolved = resolveAll(resolver, imports);
      coldTimes.push(performance.now() - started);
      if (pass === 0) coldResolved = resolved;
    }
    const coldMs = Math.min(...coldTimes);
    if (resolver === undefined) {
      throw new Error("el bench no midió ninguna pasada");
    }

    const warmStarted = performance.now();
    const warmResolved = resolveAll(resolver, imports);
    const warmMs = performance.now() - warmStarted;

    console.log(
      `module-resolution bench — ${imports.length} imports, ` +
        `cold ${coldMs.toFixed(2)} ms (best of ${COLD_PASSES}: ` +
        `${coldTimes.map((ms) => ms.toFixed(1)).join(", ")}), ` +
        `warm ${warmMs.toFixed(2)} ms (budget ${BUDGET_MS} ms)`,
    );
    console.log(`  resolved: ${coldResolved}/${imports.length} (cold), ` +
      `${warmResolved}/${imports.length} (warm)`);

    if (coldResolved !== imports.length) {
      console.error(
        `module-resolution bench — only ${coldResolved}/${imports.length} ` +
          `imports resolved. The resolver is broken, not slow.`,
      );
      return 1;
    }

    if (process.argv.includes("--check") && coldMs > BUDGET_MS) {
      console.error(
        `module-resolution bench — ${coldMs.toFixed(2)} ms exceeds the ` +
          `${BUDGET_MS} ms budget.`,
      );
      return 1;
    }
    return 0;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exit(await main());
}
