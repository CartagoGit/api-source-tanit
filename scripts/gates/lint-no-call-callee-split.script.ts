#!/usr/bin/env bun
/**
 * `bun run lint:no-call-callee-split` — ningún scanner reconstruye el
 * verbo HTTP separando el `callee` por puntos.
 *
 * El bridge del LanguageIR entrega `callee` como string
 * (`"app.get"`, `"this.router.get"`, `"server[\"get\"]"`). Un scanner que
 * haga `call.callee.split(".")` asume que el verbo es el SEGUNDO
 * segmento. Esa asunción es falsa en cuanto el código fuente usa un
 * estilo multi-segmento:
 *
 *   - `this.router.get("/x")` → split → ["this","router","get"] → se
 *     queda con "router" como verbo → la ruta se DESCARTA.
 *   - `server["get"]("/x")`   → split → ["server[\"get\"]"]           →
 *     no hay segundo segmento → verbo `undefined` → se DESCARTA.
 *
 * El collector ya clasifica el receiver con `receiverKind` y resuelve el
 * verbo en `method`/`resolvedMethod`. El scanner debe consumir ESOS
 * campos, no volver a parsear el texto. x00038 / a00016 S6 cerró el
 * último `callee.split(".")`; este gate impide que vuelva.
 *
 * La regla general (universal bootstrap §6): un bug se cierra con un
 * gate que impida repetir la CATEGORÍA, no solo el caso. Ver el patrón
 * en lint:regex-state y lint:effective-project-root.
 *
 * Uso:
 *   bun run lint:no-call-callee-split
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/**
 * Escritura literal del anti-patrón: dividir UN `callee` por ".".
 *
 * `callee` es el identificador canónico del campo; al exigir que la
 * variable que se parte se llame así (o sea `call.callee`), el gate no
 * marca los `split(".")` legítimos sobre otras cadenas (rutas de
 * fichero, dominio de un email, etc.).
 */
const FORBIDDEN = /\bcallee\s*\.\s*split\s*\(/;

/** Solo los scanners son el área vigilada. */
const WATCHED_DIR = "packages/frameworks";

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      await collect(full, out);
    } else if (entry.name.endsWith(".scanner.ts")) {
      out.push(full);
    }
  }
  return out;
}

async function main(): Promise<number> {
  const files = await collect(join(REPO_ROOT, WATCHED_DIR));
  const problems: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      // Ignora la línea si es un comentario (el gate documenta el
      // anti-patrón con ejemplos en comentarios; no debe auto-marparse).
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        continue;
      }
      if (FORBIDDEN.test(line)) {
        problems.push(`${relative(REPO_ROOT, file).replaceAll("\\", "/")}:${i + 1}`);
      }
    }
  }
  if (problems.length > 0) {
    process.stderr.write(
      "lint:no-call-callee-split — un scanner vuelve a derivar el verbo de\n" +
        "`callee.split(...)` en lugar de consumir `method`/`receiver` del IR:\n",
    );
    for (const p of problems) process.stderr.write(`  ✗ ${p}\n`);
    process.stderr.write(
      "\nUsa call.method / call.receiver / call.receiverKind (x00038).\n",
    );
    return 1;
  }
  process.stdout.write(
    `lint:no-call-callee-split — ${files.length} scanners, ninguno reconstruye el verbo por split.\n`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
