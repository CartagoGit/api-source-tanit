#!/usr/bin/env bun
/**
 * `bun run test:changed` — corre solo los gates de lo que has tocado.
 *
 * La suite entera tarda ~4 s hoy, pero crece con cada framework nuevo, y
 * el bucle de trabajo real es "toco un scanner, quiero saber en 1 s si
 * lo he roto". Esto mira el diff, lo traduce a secciones y corre solo
 * esas — más las que dependen de ellas, que es la parte que la gente
 * olvida al hacerlo a mano.
 *
 * El mapa de secciones NO vive aquí: sale de `sections.ts`, el mismo
 * que usan vitest y el typecheck.
 *
 * Uso:
 *   bun run test:changed                # vs. el upstream de la rama
 *   bun run test:changed --base main    # vs. otra referencia
 *   bun run test:changed --staged       # solo lo que está en el index
 *   bun run test:changed --all          # todo, sin mirar el diff
 *   bun run test:changed --dry-run      # dice qué correría y sale
 */
import { spawnSync } from "node:child_process";

import { SECTIONS, sectionsForFiles, withDependents } from "./sections.constant.js";
import { REPO_ROOT } from "../helpers/root.helper.js";

/** Ficheros cambiados según el modo pedido. */
function changedFiles(argv: readonly string[]): { files: string[]; against: string } {
  if (argv.includes("--staged")) {
    return { files: git(["diff", "--name-only", "--cached"]), against: "el index" };
  }

  const baseIndex = argv.indexOf("--base");
  const base = baseIndex === -1 ? defaultBase() : argv[baseIndex + 1];
  if (!base) {
    // Sin base utilizable (repo recién creado, rama huérfana): lo que
    // haya sin commitear es lo único que se puede comparar.
    return { files: git(["diff", "--name-only", "HEAD"]), against: "HEAD" };
  }

  // Cambios commiteados desde la base + los que aún no lo están.
  return {
    files: [...git(["diff", "--name-only", `${base}...HEAD`]), ...git(["diff", "--name-only"])],
    against: base,
  };
}

/** Upstream de la rama actual, o la rama por defecto si no hay. */
function defaultBase(): string | undefined {
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])[0];
  if (upstream) return upstream;
  for (const candidate of ["origin/develop", "origin/main", "develop", "main"]) {
    if (git(["rev-parse", "--verify", "--quiet", candidate]).length > 0) return candidate;
  }
  return undefined;
}

function git(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0) return [];
  // `stdout` está declarado como `Buffer | string`: con `encoding` es
  // siempre string, pero el tipo no lo sabe.
  return String(result.stdout)
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean);
}

function run(command: string, args: readonly string[]): number {
  const result = spawnSync(command, [...args], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const all = argv.includes("--all");
  const dryRun = argv.includes("--dry-run");

  let selected = [...SECTIONS];
  let reason = "--all";

  if (!all) {
    const { files, against } = changedFiles(argv);
    if (files.length === 0) {
      console.log(`test:changed — sin cambios frente a ${against}. Nada que correr.`);
      return 0;
    }
    const direct = sectionsForFiles(files);
    selected = withDependents(direct);
    reason = `${files.length} fichero(s) frente a ${against}`;

    const indirect = selected.filter((s) => !direct.includes(s));
    console.log(`test:changed — ${reason}`);
    console.log(`  · tocadas:    ${direct.map((s) => s.name).join(", ") || "(ninguna)"}`);
    if (indirect.length > 0) {
      console.log(`  · dependen:   ${indirect.map((s) => s.name).join(", ")}`);
    }

    if (selected.length === 0) {
      console.log("  · ninguna sección afectada (docs, propuestas…). Nada que correr.");
      return 0;
    }
  } else {
    console.log("test:changed — --all: todas las secciones");
  }

  if (dryRun) {
    console.log(`\n(dry-run) correría: vitest --project ${selected.map((s) => s.name).join(" --project ")}`);
    return 0;
  }

  const projects = selected.flatMap((section) => ["--project", section.name]);
  return run("bunx", ["vitest", "run", ...projects]);
}

if (import.meta.main) {
  process.exit(await main());
}
