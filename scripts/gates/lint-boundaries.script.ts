#!/usr/bin/env bun
/**
 * `bun run lint:boundaries` — que nadie cruce límites entre secciones.
 *
 * La regla que importa: **el núcleo no puede importar de
 * `frameworks/`**. Es lo único que separa "somos agnósticos" de
 * "decimos que somos agnósticos". Y se rompe sola: alguien necesita una
 * función que casualmente vive en el scanner de Laravel, la importa, y
 * a partir de ahí `services/` ya no compila sin arrastrar PHP.
 *
 * Ya pasó. `generation.pipeline` importaba el registro de scanners,
 * `collection-builder` importaba el parser de rutas de Laravel, y
 * `summary.service` los dos. Nadie lo vio porque nada lo miraba.
 *
 * Las dependencias permitidas se declaran en `sections.ts`
 * (`dependsOn`), el mismo sitio del que salen los projects de vitest y
 * los tsconfig. Una sección puede importar de sí misma y de aquellas de
 * las que declara depender; nada más.
 *
 * Uso:
 *   bun run lint:boundaries
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { moduleDir } from "../../helpers/module-path.helper.js";
import { SECTIONS, bestSectionFor, type ISection } from "./sections.js";

const PACKAGE_ROOT = resolve(moduleDir(import.meta.url), "..", "..");

/** Carpetas que no se recorren. */
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".cache", "docs"]);

/** Un import que cruza de una sección a otra. */
interface ICrossing {
  readonly from: string;
  readonly fromSection: string;
  readonly toSection: string;
  readonly specifier: string;
  readonly line: number;
}

async function collectTsFiles(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as never;
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectTsFiles(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Especificadores relativos importados por un fichero, con su línea. */
function relativeImports(source: string): Array<{ specifier: string; line: number }> {
  const found: Array<{ specifier: string; line: number }> = [];
  const lines = source.split("\n");
  const re = /(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Los comentarios mencionan rutas constantemente; no son imports.
    if (/^\s*(\*|\/\/)/.test(line)) continue;
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(line)) !== null) {
      if (match[1]) found.push({ specifier: match[1], line: i + 1 });
    }
  }
  return found;
}

/** ¿Puede `from` importar de `to`? */
function isAllowed(from: ISection, toName: string): boolean {
  return from.name === toName || from.dependsOn.includes(toName);
}

async function main(): Promise<number> {
  const files = await collectTsFiles(PACKAGE_ROOT);
  const crossings: ICrossing[] = [];
  let checked = 0;

  for (const file of files) {
    const rel = relative(PACKAGE_ROOT, file).replaceAll("\\", "/");
    const fromSection = bestSectionFor(rel);
    // Los tests declaran su sección por su carpeta, no por lo que
    // prueban; los de `tests/helpers` son transversales y se saltan.
    if (!fromSection || rel.startsWith("tests/helpers/")) continue;
    checked++;

    const source = await readFile(file, "utf8");
    for (const { specifier, line } of relativeImports(source)) {
      const target = relative(PACKAGE_ROOT, resolve(file, "..", specifier))
        .replaceAll("\\", "/")
        .replace(/\.js$/, ".ts");
      const toSection = bestSectionFor(target);
      if (!toSection || toSection.name === fromSection.name) continue;
      if (isAllowed(fromSection, toSection.name)) continue;
      crossings.push({
        from: rel,
        fromSection: fromSection.name,
        toSection: toSection.name,
        specifier,
        line,
      });
    }
  }

  if (crossings.length > 0) {
    console.error(`lint:boundaries — ${crossings.length} import(s) fuera de sitio:\n`);
    for (const crossing of crossings) {
      console.error(
        `  ✗ ${crossing.from}:${crossing.line}\n` +
          `      ${crossing.fromSection} → ${crossing.toSection} · "${crossing.specifier}"\n` +
          `      "${crossing.fromSection}" solo puede importar de: ` +
          `${[crossing.fromSection, ...(SECTIONS.find((s) => s.name === crossing.fromSection)?.dependsOn ?? [])].join(", ")}`,
      );
    }
    return 1;
  }

  const summary = SECTIONS.map(
    (section) =>
      `${section.name}${section.dependsOn.length > 0 ? `→${section.dependsOn.join("+")}` : ""}`,
  ).join(", ");
  console.log(`lint:boundaries — ${checked} ficheros, sin cruces (${summary})`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
