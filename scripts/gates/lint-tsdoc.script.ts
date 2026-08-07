#!/usr/bin/env bun
/**
 * `bun run lint:tsdoc` — lo que se puede importar, se explica.
 *
 * El alcance no es "todo lo exportado": es lo que **otra persona puede
 * importar**, o sea lo que el `exports` del `package.json` deja entrar:
 *
 *     "./core/*"      → projects/core/**
 *     "./frameworks"  → projects/frameworks/index.ts
 *
 * Un `export` dentro de un scanner o de un comando del CLI es exportado
 * para el propio repo —para que lo vea su test, o el módulo de al lado—
 * y exigirle documentación de API sería pedir que se documente un
 * detalle interno. La regla que este lint defiende es más concreta y por
 * eso se puede sostener: **si alguien puede escribirlo en un `import`,
 * tiene que poder leer qué hace sin abrir el fuente.**
 *
 * Un docblock vacío o de relleno (`/** El registro. *\/` sobre algo
 * llamado `registry`) no cuenta: repetir el nombre en prosa no explica
 * nada y además envejece igual. Se exige que diga algo más que el propio
 * identificador.
 *
 * Uso:
 *   bun run lint:tsdoc
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/**
 * Lo que el `package.json` publica como importable.
 *
 * Si algún día `exports` crece, esta lista tiene que crecer con él — y
 * `lint-tsdoc.spec.ts` lo comprueba comparando las dos.
 */
export const PUBLIC_ROOTS = [
  "projects/core",
  "projects/frameworks/index.ts",
] as const;

/** Un `export` de nivel superior. Los de dentro de una clase no cuentan. */
const EXPORT_RE =
  /^export\s+(?:declare\s+)?(?:async\s+)?(function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

/** `export { a, b } from "…"` solo reexporta: lo documenta su origen. */
const REEXPORT_RE = /^export\s*(?:\*|\{)/;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);

/**
 * Palabras que no aportan nada por sí solas.
 *
 * Un docblock que solo diga "el registro" sobre `registry` es ruido con
 * forma de documentación: ocupa el sitio del comentario que sí haría
 * falta y pasa el gate.
 */
const FILLER = new Set([
  "el", "la", "los", "las", "un", "una", "de", "del", "para", "por", "con",
  "the", "a", "an", "of", "for", "to",
]);

export interface ITsDocFinding {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly kind: string;
  readonly reason: string;
}

/**
 * El docblock inmediatamente encima de `index`, si lo hay.
 *
 * Se salta las anotaciones (`@deprecated`, decoradores) que pueden ir
 * entre el comentario y la declaración.
 */
function docBlockAbove(lines: ReadonlyArray<string>, index: number): string | null {
  let i = index - 1;
  while (i >= 0) {
    const line = (lines[i] ?? "").trim();
    if (line === "" || line.startsWith("@")) {
      i--;
      continue;
    }
    break;
  }
  if (i < 0 || !(lines[i] ?? "").trim().endsWith("*/")) return null;

  // Subir hasta el `/**` que lo abre.
  const end = i;
  while (i >= 0 && !(lines[i] ?? "").trim().startsWith("/**")) i--;
  if (i < 0) return null;
  return lines
    .slice(i, end + 1)
    .join("\n")
    .replace(/^\s*\/\*\*|\*\/\s*$/g, "")
    .replace(/^\s*\*/gm, "")
    .trim();
}

/**
 * Si el texto dice algo más que el nombre del símbolo.
 *
 * Se comparan las palabras con contenido: un docblock cuyo vocabulario
 * está entero dentro del identificador no está explicando, está
 * repitiendo.
 */
function saysSomething(doc: string, name: string): boolean {
  const words = doc
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER.has(w));
  if (words.length < 3) return false;

  // `AUTH_TOKEN_VARIABLE` → ["auth","token","variable"].
  const fromName = new Set(
    name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]/g, " ")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean),
  );
  return words.some((w) => !fromName.has(w));
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
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Los ficheros del área pública. */
export async function publicFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const root of PUBLIC_ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (root.endsWith(".ts")) files.push(abs);
    else await collect(abs, files);
  }
  return files;
}

export async function findUndocumented(
  files: ReadonlyArray<string>,
): Promise<ITsDocFinding[]> {
  const findings: ITsDocFinding[] = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    let source: string;
    try {
      source = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (REEXPORT_RE.test(line)) continue;
      const match = EXPORT_RE.exec(line);
      if (!match) continue;
      const [, kind = "", name = ""] = match;

      const doc = docBlockAbove(lines, i);
      if (doc === null) {
        findings.push({ file: rel, line: i + 1, name, kind, reason: "sin docblock" });
        continue;
      }
      if (!saysSomething(doc, name)) {
        findings.push({
          file: rel,
          line: i + 1,
          name,
          kind,
          reason: "el docblock solo repite el nombre",
        });
      }
    }
  }
  return findings;
}

async function main(): Promise<number> {
  const files = await publicFiles();
  const findings = await findUndocumented(files);

  if (findings.length > 0) {
    console.error(
      `lint:tsdoc — ${findings.length} export(s) público(s) sin explicar:\n`,
    );
    for (const f of findings) {
      console.error(`  ✗ ${f.file}:${f.line} — ${f.kind} \`${f.name}\`: ${f.reason}`);
    }
    console.error(
      "\n  Estos se pueden importar desde fuera del repo (ver `exports` del\n" +
        "  package.json). Di qué hacen y, cuando no sea obvio, por qué existen:\n" +
        "  el porqué es lo que no se puede deducir leyendo la firma.\n",
    );
    return 1;
  }

  console.log(
    `lint:tsdoc — ${files.length} ficheros del área pública, todos sus exports explicados`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
