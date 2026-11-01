#!/usr/bin/env bun
/**
 * `bun run lint:spec-isolation` — rechaza el patrón
 * `const specs = [...discovery.specs]` en código de discovery.
 * x00028 S4.
 *
 * Por qué existe
 * ──────────────
 * El bug que cerró x00028 era construir cada colección de servicio
 * con `const specs = [...discovery.specs]`, lo que hacía que todos
 * los servicios vieran el catálogo global. En un monorepo
 * `apps/users` + `apps/orders`, ambos veían ambos `GET /health` y
 * todas las rutas cruzadas.
 *
 * La fix es llamar al helper
 * `filterSpecsForService(discovery.specs, service)` en su lugar. Este
 * gate detecta el patrón y obliga a usar el helper.
 *
 * Qué considera violación
 * ───────────────────────
 * - Coincidencias literales de la forma
 *   `const <algo> = [...discovery.specs]` o
 *   `const <algo> = [...discovery.specs];` en código de
 *   `packages/core/discovery`.
 * - Excepción: el propio helper `filter-specs-for-service.helper.ts`
 *   está exento (su cuerpo contiene la firma que detecta para
 *   documentar el patrón).
 *
 * Uso
 * ───
 *   bun run lint:spec-isolation
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

const SCAN_DIR = join(REPO_ROOT, "packages", "core", "discovery");

const ALLOWED = new Set([
  // El propio helper documenta el patrón en su JSDoc y firma.
  "packages/core/discovery/filter-specs-for-service.helper.ts",
]);

const BAD = /\[\s*\.\.\.\s*discovery\.specs\s*\]/g;

interface IViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

async function scanFile(absPath: string): Promise<IViolation[]> {
  const rel = relative(REPO_ROOT, absPath);
  if (ALLOWED.has(rel)) return [];
  const source = await readFile(absPath, "utf8");
  const violations: IViolation[] = [];
  // We iterate with `matchAll`, which never touches the regex's
  // `lastIndex`. The lint:regex-state gate rejects module-level
  // `g`-flag regexes mutated via `.exec()` because two concurrent
  // scans would share the cursor. `matchAll` is the safe variant
  // for a gate that walks many files in sequence — and across
  // processes (CI runs `lint` concurrently with other scripts).
  for (const m of source.matchAll(BAD)) {
    const offset = m.index ?? 0;
    let line = 1;
    for (let i = 0; i < offset; i++) {
      if (source.charCodeAt(i) === 10) line++;
    }
    const lineStart = source.lastIndexOf("\n", offset) + 1;
    const lineEnd = source.indexOf("\n", offset);
    const text = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
    violations.push({ file: rel, line, text });
  }
  return violations;
}

async function scanDir(dir: string): Promise<IViolation[]> {
  const out: IViolation[] = [];
  let entries: Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await scanDir(full)));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    out.push(...(await scanFile(full)));
  }
  return out;
}

export async function main(): Promise<number> {
  const violations = await scanDir(SCAN_DIR);
  if (violations.length === 0) {
    console.log(
      `lint:spec-isolation -- 0 violaciones en ${relative(REPO_ROOT, SCAN_DIR)} (todas las colecciones se construyen desde filterSpecsForService)`,
    );
    return 0;
  }
  console.error(
    `lint:spec-isolation -- ${violations.length} violacion(es) en ${relative(REPO_ROOT, SCAN_DIR)}:\n`,
  );
  for (const v of violations) {
    console.error(`  ✗ ${v.file}:${v.line}`);
    console.error(`      ${v.text}`);
    console.error(
      `      Razon: \`[...discovery.specs]\` comparte el catálogo global entre servicios. ` +
        `Cada servicio debe ver solo sus specs -- usa \`filterSpecsForService(discovery.specs, service)\`.\n`,
    );
  }
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
