#!/usr/bin/env bun
/**
 * `bun run scripts/gates/move-module.script.ts <origen> <destino> …`
 *
 * Mueve ficheros o carpetas y **recalcula** todos los imports relativos
 * del repo: los que apuntaban a lo movido, y los que salían de dentro de
 * lo movido hacia fuera.
 *
 * Existe porque hacerlo con `sed` sale mal de tres formas distintas —y
 * las tres pasaron durante esta reorganización: se cuela un import
 * dentro de un bloque multilínea, se reescribe la mención de una ruta
 * dentro de un comentario, o se deja un `../` de más porque la
 * profundidad cambió y nadie la recalculó.
 *
 * Aquí no se sustituye texto: se resuelve cada especificador a una ruta
 * absoluta, se le aplica el mapa de movimientos, y se vuelve a calcular
 * la ruta relativa desde donde acabe el fichero que importa.
 *
 * Uso:
 *   bun run scripts/gates/move-module.script.ts services/foo.service.ts projects/core/domain/foo.service.ts
 *   bun run scripts/gates/move-module.script.ts --dry-run <origen> <destino>
 */
import { readdir, readFile, rename, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { REPO_ROOT } from "../helpers/root.helper.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache"]);

/** Movimiento pedido, con las dos rutas ya absolutas. */
interface IMove {
  readonly from: string;
  readonly to: string;
}

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Aplica el mapa de movimientos a una ruta absoluta. */
function relocate(absolute: string, moves: readonly IMove[]): string {
  for (const move of moves) {
    if (absolute === move.from) return move.to;
    const prefix = move.from.endsWith(sep) ? move.from : move.from + sep;
    if (absolute.startsWith(prefix)) {
      return join(move.to, absolute.slice(prefix.length));
    }
  }
  return absolute;
}

/** Especificador relativo, con la extensión `.js` que use el original. */
function toSpecifier(fromFile: string, targetAbs: string, hadJsExtension: boolean): string {
  let spec = relative(dirname(fromFile), targetAbs).split(sep).join("/");
  if (!spec.startsWith(".")) spec = `./${spec}`;
  spec = spec.replace(/\.ts$/, "");
  return hadJsExtension ? `${spec}.js` : spec;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const dryRun = argv.includes("--dry-run");
  const positional = argv.filter((arg) => !arg.startsWith("--"));

  if (positional.length === 0 || positional.length % 2 !== 0) {
    console.error("uso: move-module.script.ts [--dry-run] <origen> <destino> [<origen> <destino>…]");
    return 1;
  }

  const moves: IMove[] = [];
  for (let i = 0; i < positional.length; i += 2) {
    moves.push({
      from: resolve(REPO_ROOT, positional[i]!),
      to: resolve(REPO_ROOT, positional[i + 1]!),
    });
  }

  const files = await collect(REPO_ROOT);
  let touched = 0;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    // Dónde acabará ESTE fichero: puede que también se esté moviendo.
    const fileAfter = relocate(file, moves);

    const rewritten = source.replace(
      /(from\s*|import\s*\(\s*)(["'])(\.[^"']*)\2/g,
      (whole, lead: string, quote: string, spec: string) => {
        const hadJs = spec.endsWith(".js");
        const bare = spec.replace(/\.js$/, "");
        // Se prueban las dos formas porque el repo importa con y sin
        // extensión según sea código de producción o de test.
        const candidates = [`${bare}.ts`, `${bare}/index.ts`, bare];
        for (const candidate of candidates) {
          const targetBefore = resolve(dirname(file), candidate);
          const targetAfter = relocate(targetBefore, moves);
          if (targetAfter === targetBefore && fileAfter === file) continue;
          const next = toSpecifier(
            fileAfter,
            targetAfter.endsWith("/index.ts") && !bare.endsWith("index")
              ? dirname(targetAfter)
              : targetAfter,
            hadJs,
          );
          return `${lead}${quote}${next}${quote}`;
        }
        return whole;
      },
    );

    if (rewritten !== source) {
      touched++;
      if (!dryRun) await writeFile(file, rewritten);
    }
  }

  if (!dryRun) {
    for (const move of moves) {
      await mkdir(dirname(move.to), { recursive: true });
      await rename(move.from, move.to);
    }
  }

  const label = dryRun ? "(dry-run) " : "";
  console.log(
    `${label}${moves.length} movimiento(s), ${touched} fichero(s) con imports recalculados`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
