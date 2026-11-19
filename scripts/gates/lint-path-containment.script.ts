#!/usr/bin/env bun
/**
 * `bun run lint:path-containment` — prohibido fiar el "está dentro
 * del proyecto" a un prefijo de cadena.
 *
 * Hallazgo P2 del audit 2026-09-04 (`x00022`):
 * `packages/core/discovery/project-context.service.ts#toProjectRelative`
 * decidía si una ruta caía dentro del proyecto con
 * `normalized.startsWith(context.projectRoot)`. `startsWith` no
 * entiende de fronteras de segmento, así que `/home/u/api-secret/x.ts`
 * matcheaba falsamente `/home/u/api`. El bug se cerró sustituyendo esa
 * comprobación por `relative()` + chequeo de prefijo `..${sep}` o
 * absoluto, pero un patrón tan tentador como `startsWith(root)` es
 * fácil de reintroducir sin querer. Este gate se encarga de que no.
 *
 * Qué prohíbe:
 *
 *   - `<expr>.startsWith(<algo>.projectRoot)` en `packages/core/` o
 *     `packages/cli/`. La `.projectRoot` puede ir precedida de un
 *     identificador cualquiera (`context.projectRoot`,
 *     `ctx.projectRoot`, `this.projectRoot`, …).
 *   - `<expr>.startsWith(<algo>.workspace)` por la misma razón: un
 *     workspace como `packages/foo` empieza por `packages/f`, y eso
 *     también colisiona con prefijos.
 *
 * Qué permite:
 *
 *   - Líneas de comentario, que a veces explican el patrón prohibido
 *     a propósito (este gate lo hace).
 *   - Comentarios `// LINT-ALLOW: <motivo>` en la misma línea o en la
 *     inmediatamente anterior. Si un día hace falta romper la regla
 *     de verdad, mejor dejar el motivo fechado que reescribir el gate.
 *
 * Uso:
 *   bun run lint:path-containment
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/** Solo se miran estos dos paquetes. Los scanners viven fuera. */
const SCAN_ROOTS = ["packages/core", "packages/cli"];

/**
 * Patrón: `.startsWith(<algo>.projectRoot)` o `.startsWith(<algo>.workspace)`.
 *
 * El `\.\s*` antes de `projectRoot|workspace` exige que la palabra
 * vaya precedida de un punto (con espacios opcionales). Eso evita
 * falsos positivos sobre variables que se llamen `myWorkspace` o
 * `localProjectRoot`, que no son accesos a propiedades.
 */
const STARTS_WITH_ROOT =
  /\.startsWith\([^)]*\.\s*(?:projectRoot|workspace)\b/;

/** Comentario de escape: línea actual o la anterior. */
const ALLOW_COMMENT = /\/\/\s*LINT-ALLOW\b/;

/** Saltar líneas que son comentarios. */
const COMMENT_LINE = /^\s*(\/\*|\*|\/\/)/;

/** Carpetas que no se recorren. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  "fixtures",
  "smoke-fixtures",
  "docs",
]);

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
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

async function main(): Promise<number> {
  const problems: string[] = [];
  let checked = 0;

  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    const files = await collect(abs);
    for (const file of files) {
      checked++;
      const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const lines = (await readFile(file, "utf8")).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (COMMENT_LINE.test(line)) continue;
        if (!STARTS_WITH_ROOT.test(line)) continue;
        const prev = i > 0 ? lines[i - 1] ?? "" : "";
        if (ALLOW_COMMENT.test(line) || ALLOW_COMMENT.test(prev)) continue;
        problems.push(
          `${rel}:${i + 1}\n      ${line.trim()}\n` +
            "      `.startsWith(... projectRoot|workspace)` no distingue\n" +
            "      fronteras de segmento: `/home/u/api-secret` matchea\n" +
            "      falsamente `/home/u/api`. Usa `relative()` y comprueba\n" +
            "      que el resultado no empieza por `..${sep}`, ni es\n" +
            "      absoluto, ni es exactamente `..` (mira\n" +
            "      `packages/core/helpers/path-containment.helper.ts`).",
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      `lint:path-containment — ${problems.length} sitio(s) con .startsWith(... projectRoot|workspace):\n`,
    );
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error(
      "\n  Sustitúyelo por la fórmula canónica:\n" +
        "    import { isAbsolute, relative, sep } from 'node:path';\n" +
        "    const rel = relative(root, candidate);\n" +
        "    const inside =\n" +
        "      !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);\n" +
        "  Si necesitas romper la regla a propósito, añade\n" +
        "  `// LINT-ALLOW: <motivo>` en la misma línea o la anterior.",
    );
    return 1;
  }

  console.log(
    `lint:path-containment — ${checked} fichero(s) en packages/{core,cli} sin .startsWith(... projectRoot|workspace)`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
