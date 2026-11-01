#!/usr/bin/env bun
/**
 * `bun run lint:effective-project-root` — rechaza referencias directas
 * a `match.projectRoot` en los scanners. a00014 S3.
 *
 * Por qué
 * - Cada scanner del lote (21 en `packages/frameworks/scanners/*.scanner.ts`
 *   más el `packages/frameworks/laravel/laravel.scanner.ts` que recibe
 *   `projectRoot` por parámetro y queda fuera de scope) tiene que mirar
 *   el árbol donde vive el framework, no la raíz del monorepo. El helper
 *   `effectiveProjectRoot(match)` de
 *   `packages/core/discovery/effective-project-root.helper.ts` es la
 *   única primitiva que honra `match.frameworkSearchRoot` correctamente
 *   y aplica la guarda de contención (rechaza paths que escapan del
 *   `projectRoot`).
 * - Antes, cada scanner decidía por su cuenta, y la mayoría lo hacía
 *   mal: NestJS, Hono, Next.js y Express tenían su propio helper
 *   inline (`nestjsEffectiveSearchRoot`, etc.); Fastify, Fiber y Rust
 *   usaban `effectiveScanRoot`; el resto pasaba
 *   `match.projectRoot` directo a `collectFiles`. El audit
 *   2026-09-04 documentó tres fugas reales por monorepo.
 * - Migrados los 20 scanners en S2, este gate cierra el grifo: si
 *   alguien añade un scanner nuevo y vuelve a leer `match.projectRoot`
 *   directo, falla aquí antes de llegar al typecheck.
 *
 * Qué considera "violación"
 * - Cualquier línea de `*.scanner.ts` bajo `packages/frameworks/scanners/`
 *   que contenga el literal `match.projectRoot` (en código, no en
 *   comentario, no en string).
 * - Excluidos por construcción: el helper mismo
 *   (`effective-project-root.helper.ts`) y los tres comentarios que
 *   cuentan la historia (`scan-root.helper.ts` y
 *   `effective-project-root.helper.ts`). El gate escanea solo el
 *   scope "scanners".
 * - Lista blanca explícita por línea: `// LINT-ALLOW: <razón>` en la
 *   misma línea del match. Reservada para casos donde el scanner
 *   necesita el `projectRoot` real de verdad (no hay ejemplo todavía,
 *   pero la dejamos por simetría con
 *   `lint:no-instance-mutable-maps-in-scanners`).
 *
 * Uso
 *   bun run lint:effective-project-root
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { FRAMEWORKS_SCANNERS_DIR, REPO_ROOT } from "../helpers/root.helper.js";

/**
 * Coincidencia del literal `match.projectRoot`, con la misma forma
 * que tendría en código activo (no en un string). La frontera es:
 * la línea no es comentario y no está dentro de un string literal.
 *
 * Para eso el análisis línea-a-línea es suficiente en TypeScript
 * porque no hay multiline-string-without-template sin una comilla
 * de apertura que se ve en la misma línea. Los template literals
 * que cruzan líneas siguen siendo `match.projectRoot` dentro de
 * `\`...\``, lo que en código activo aparece siempre precedido de
 * un identificador o `match.` (caso cubierto) o de un comentario
 * (que se ignora).
 */
const MATCH_PROJECT_ROOT = /(^|[^"'`\\])\bmatch\.projectRoot\b/g;

/**
 * Comentarios de TS que pueden aparecer al final de la línea.
 *  - `//` hasta fin de línea
 *  - `/* ... *\/` en una sola línea (raro, pero `prettier` lo permite)
 *
 * Si la línea tiene un comentario `// LINT-ALLOW: ...` se respeta
 * la lista blanca explícita; si tiene cualquier otro comentario, el
 * `match.projectRoot` que esté dentro del comentario no cuenta,
 * pero el que esté en código antes del comentario sí cuenta.
 */
const LINT_ALLOW = /\/\/\s*LINT-ALLOW\b/;

interface IViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

/**
 * Recorre el árbol en busca de `*.scanner.ts` sin descender a
 * `node_modules` / `dist` / etc.
 */
async function collect(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (entry.name.endsWith(".scanner.ts")) out.push(full);
  }
  return out;
}

/** Convierte un offset 0-based en número de línea 1-based. */
function offsetToLine(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

async function main(): Promise<number> {
  // Scope: solo `packages/frameworks/scanners/**`. Laravel vive en
  // `packages/frameworks/laravel/` y recibe `projectRoot: string` por
  // parámetro (no `match.projectRoot`), así que está fuera de scope.
  // Si en el futuro Laravel u otro scanner se mudan a este contrato,
  // se amplía la lista blanca de dirs aquí.
  const files = await collect(FRAMEWORKS_SCANNERS_DIR);
  const violations: IViolation[] = [];

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    const source = await readFile(file, "utf8");

    // matchAll para no contaminar `lastIndex` si otra parte del
    // código reutiliza el regex. El offset del match es donde empieza
    // el identificador (`m`) — `MATCH_PROJECT_ROOT` consume dos
    // caracteres antes (`[^"'`\\]` + `m`); sumamos 1 para apuntar al
    // inicio del literal `match.projectRoot`.
    for (const match of source.matchAll(MATCH_PROJECT_ROOT)) {
      const offset = (match.index ?? 0) + (match[1]?.length ?? 0);
      const lineNumber = offsetToLine(source, offset);
      const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
      const lineEnd = source.indexOf("\n", offset);
      const rawLine = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
      // Solo nos importa lo que está en código activo, no en un
      // comentario `// ...` al final de la línea. Cortamos al primer
      // `//` (fuera de string). El regex siguiente es el habitual
      // "encuentra el `//` que no esté dentro de comillas/backticks".
      // Para líneas de scanner típicas esto es suficiente; si un
      // scanner tuviera comillas + `//` en la misma línea, el offset
      // de la coincidencia seguiría señalando al `match.projectRoot`
      // correcto y el corte nos dejaría la cita intacta.
      const COMMENT_RE = /(^|[^"'`\\])(\/\/)/;
      const commentMatch = rawLine.match(COMMENT_RE);
      const codeOnly = commentMatch
        ? rawLine.slice(0, rawLine.indexOf("//", commentMatch.index! + 1))
        : rawLine;
      const trimmedCode = codeOnly.trim();

      // Solo cuenta si el `match.projectRoot` está en código, no en
      // comentario al final de la línea.
      if (!codeOnly.includes("match.projectRoot")) continue;

      // `// LINT-ALLOW: <razón>` en la misma línea del match.
      if (LINT_ALLOW.test(rawLine)) continue;

      violations.push({
        file: rel,
        line: lineNumber,
        text: trimmedCode,
        reason:
          `referencia directa a \`match.projectRoot\`. Pasa por ` +
          `\`effectiveProjectRoot(match)\` (walk) o ` +
          `\`rawProjectRoot(match)\` (resolución de sourceFile / manifest). ` +
          `Si necesitas saltarte el gate en este caso concreto, añade ` +
          `\`// LINT-ALLOW: <razón>\` en la misma línea.`,
      });
    }
  }

  if (violations.length > 0) {
    console.error(
      `lint:effective-project-root — ${violations.length} violacion(es) en packages/frameworks/scanners:\n`,
    );
    for (const v of violations) {
      console.error(`  ✗ ${v.file}:${v.line}`);
      console.error(`      ${v.text}`);
      console.error(`      ${v.reason}\n`);
    }
    return 1;
  }

  console.log(
    `lint:effective-project-root — ${files.length} fichero(s) revisado(s) en packages/frameworks/scanners, ninguno lee match.projectRoot directamente`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
