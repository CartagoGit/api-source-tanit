#!/usr/bin/env bun
/**
 * `bun run typecheck` — tipa cada sección por separado.
 *
 * Un solo `tsc` sobre todo el repo pasa aunque las capas estén
 * enredadas: mientras el programa completo compile, da igual quién
 * importe a quién. Tipar sección a sección es lo que obliga a que
 * `core` compile **sin** `frameworks/` delante.
 *
 * Y no es teórico: al separarlos apareció que `setTimeout` y varios
 * miembros de `node:fs` no estaban declarados en ningún sitio. El
 * proyecto raíz no se enteraba porque `vitest.config.ts` arrastraba los
 * tipos de vitest, que traen los de node de refilón. En cuanto `core`
 * pasó a tipar solo, dejaron de existir.
 *
 * Uso:
 *   bun run typecheck                # todas las secciones
 *   bun run typecheck core           # solo una
 *   bun run typecheck core frameworks
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { repoRoot } from "../../projects/core/helpers/module-path.helper.js";
import { SECTIONS, sectionByName, type ISection } from "./sections.constant.js";

const PACKAGE_ROOT = repoRoot(import.meta.url);

/** Corre `tsc --noEmit` sobre el proyecto de una sección. */
function typecheck(section: ISection): boolean {
  const started = Date.now();
  const result = section.ownTypecheck
    ? spawnSync("bun", ["run", "--cwd", section.ownTypecheck.cwd, section.ownTypecheck.script], {
        cwd: PACKAGE_ROOT,
        encoding: "utf8",
      })
    : spawnSync("bunx", ["tsc", "--noEmit", "-p", section.tsconfig], {
        cwd: PACKAGE_ROOT,
        encoding: "utf8",
      });
  const ms = Date.now() - started;
  const output = `${String(result.stdout ?? "")}${String(result.stderr ?? "")}`.trim();

  if (result.status === 0) {
    console.log(`  ✔ ${section.name.padEnd(11)} ${section.description} (${ms} ms)`);
    return true;
  }
  console.error(`  ✗ ${section.name.padEnd(11)} ${section.description}`);
  if (output) {
    for (const line of output.split("\n")) console.error(`      ${line}`);
  }
  return false;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const requested = argv.filter((arg) => !arg.startsWith("-"));

  let sections: ISection[];
  if (requested.length === 0) {
    sections = [...SECTIONS];
  } else {
    sections = [];
    for (const name of requested) {
      const section = sectionByName(name);
      if (!section) {
        console.error(
          `typecheck — no existe la sección "${name}". ` +
            `Hay: ${SECTIONS.map((s) => s.name).join(", ")}`,
        );
        return 1;
      }
      sections.push(section);
    }
  }

  console.log(`typecheck — ${sections.length} sección(es)`);
  // Se corren todas aunque una falle: enterarse de los tres fallos de
  // golpe ahorra dos vueltas.
  const failed = sections.filter((section) => !typecheck(section));

  if (failed.length > 0) {
    console.error(`\ntypecheck — falla ${failed.map((s) => s.name).join(", ")}`);
    return 1;
  }
  console.log("typecheck — todas las secciones tipan por separado");
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
