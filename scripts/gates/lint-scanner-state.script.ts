#!/usr/bin/env bun
/**
 * `bun run lint:scanner-state-isolation` — rechaza el patron
 * `new Map(<expr>.map(... => [<key>, <value>]))` en codigo de
 * discovery. x00025 S2.
 *
 * Por que
 * - El bug que cerro x00025 era construir `routesByService` asi:
 *
 *     new Map(
 *       perScanner.map(({ serviceId, scannerSpecs }) => [
 *         serviceId,
 *         routes.filter(...),
 *       ]),
 *     );
 *
 *   Si dos scanners comparten `serviceId` (caso hibrido Express +
 *   GraphQL bajo el mismo `frameworkSearchRoot`), el segundo tuple
 *   **sobrescribe** el primero y la coleccion sale incompleta sin
 *   error visible.
 * - La fix es acumular con bucle `for` explicito (o un helper puro
 *   como `accumulateRoutesByService`), nunca `new Map(... .map(...))`.
 * - Este gate detecta el patron y obliga a usar el helper.
 *
 * Que considera "violacion"
 * - Coincidencia de la forma `new Map(<ident>.map((<args>) => [<key>,
 *   <value>]))` donde `<key>` deriva de una identidad del scanner
 *   (`serviceId`, `match`, `framework`, `service`) o destructuring
 *   estilo `{ serviceId, scannerSpecs }`.
 * - Coincidencias literales `new Map([...])` con arrays estaticos NO
 *   son violaciones — son el camino legitimo de un solo elemento.
 *
 * Uso
 *   bun run lint:scanner-state-isolation
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

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

/** El propio lint contiene el patron que detecta. */
const ALLOWED = new Set([
  "scripts/gates/lint-scanner-state.script.ts",
]);

/**
 * Detectores del primer slot del tuple dentro de `.map(...) => [<key>, ...]`.
 *
 * Lista cerrada de identificadores "scanner-shaped": si el primer slot
 * del array interno es uno de estos, el map esta construyendo un
 * indice por identidad de scanner, y eso es exactamente lo que
 * provocaba el bug de sobrescritura. Si es otra cosa (por ejemplo un
 * literal o `String(x)`), no es el patron que buscamos.
 */
const SCANNER_KEY_IDENTS = new Set([
  "serviceId",
  "service",
  "match",
  "framework",
  "scannerSpecs",
]);

/**
 * Regex principal: `new Map(X.map((ARGS) => [KEY, ...]))` multi-linea.
 *
 * Captura tres grupos:
 *  1. `X` — la expresion sobre la que se llama `.map`. No se usa, se
 *     incluye solo para que el regex sea mas estricto.
 *  2. `ARGS` — el parametro del callback (destructuring `{ ... }` o
 *     flat `(x, y)`).
 *  3. `KEY` — el primer slot del tuple interno. Si es un identificador
 *     "scanner-shaped" (`serviceId` / `match` / etc.), flag.
 *
 * Multi-linea: el bug real estaba partido en 4 lineas
 * (`new Map(\n  perScanner.map(({ serviceId, scannerSpecs }) => [\n    serviceId,\n    ...\n  ]),\n)`).
 * El regex usa `\s+` entre tokens para soportar saltos de linea.
 */
const BAD_MAP = new RegExp(
  String.raw`new\s+Map\s*\(\s*[\w$.]+\s*\.\s*map\s*\(\s*(?:\(\s*\{([^}]+)\}\s*\)|\(([^)]+)\))\s*=>\s*\[\s*([A-Za-z_$][\w$]*)\s*,`,
  "g",
);

/** Convierte un offset de bytes en una posicion del fichero a numero de linea 1-based. */
function offsetToLine(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

interface IViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
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
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

async function main(): Promise<number> {
  // Scope: solo `packages/core/discovery/**` — la regla no aplica a
  // adapters, frameworks ni a `packages/core/domain`. El bug es del
  // discovery; si en el futuro otro paquete quiere la misma proteccion,
  // se ampla aqui.
  const discoveryDir = join(REPO_ROOT, "packages", "core", "discovery");
  const files = await collect(discoveryDir);
  const violations: IViolation[] = [];

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (ALLOWED.has(rel)) continue;

    const source = await readFile(file, "utf8");

    // Escaneo multi-linea: el regex usa `\s+` que acepta saltos de
    // linea. Reportamos el numero de linea del `new Map(` para que el
    // mensaje apunte al sitio correcto (no a la linea donde por
    // casualidad quedo el `[`).
    //
    // Importante: `BAD_MAP` lleva el flag `g`, y un `RegExp` con `g`
    // comparte `lastIndex` entre llamadas. Si otra parte del codigo
    // (o un futuro test) lo reutiliza, las posiciones se pisan. Por
    // eso usamos `matchAll`, que NO muta `lastIndex`.
    for (const match of source.matchAll(BAD_MAP)) {
      const destructured = match[1];
      const flatArgs = match[2];
      const keyIdent = match[3];

      if (keyIdent === undefined) continue;
      if (!SCANNER_KEY_IDENTS.has(keyIdent)) continue;

      // Solo es scanner-shaped si el destructuring trae campos tipicos
      // de un scanner (`serviceId`, `scannerSpecs`, `framework`,
      // `match`, etc.) O si los flat args mencionan `serviceId`.
      // Esto evita falsos positivos con `.map(x => [x.id, ...])`
      // donde `x.id` no es serviceId.
      const isScannerShape =
        (destructured !== undefined &&
          /(?:^|[\s,{])(?:serviceId|scannerSpecs|match|framework|service)(?=[\s,}])/.test(
            destructured,
          )) ||
        (flatArgs !== undefined && /\bserviceId\b/.test(flatArgs));

      if (!isScannerShape) continue;

      const lineNumber = offsetToLine(source, match.index);
      const lineText = source.slice(0, match.index).split("\n").pop() ?? "";

      violations.push({
        file: rel,
        line: lineNumber,
        text: lineText.trim(),
        reason:
          `patron new Map(... .map(... => [${keyIdent}, ...])) detectado: ` +
          `con ` +
          `${keyIdent} como clave, dos entradas con la misma identidad ` +
          `sobreescriben en silencio (x00025). Acumula con bucle ` +
          `explicito o usa el helper ` +
          `\`accumulateRoutesByService(perScanner, routes)\` de ` +
          `\`packages/core/discovery/accumulate-routes-by-service.helper.ts\`.`,
      });
    }
  }

  if (violations.length > 0) {
    console.error(
      `lint:scanner-state-isolation — ${violations.length} violacion(es) en packages/core/discovery:\n`,
    );
    for (const v of violations) {
      console.error(`  ✗ ${v.file}:${v.line}`);
      console.error(`      ${v.text}`);
      console.error(`      ${v.reason}\n`);
    }
    return 1;
  }

  console.log(
    `lint:scanner-state-isolation — ${files.length} fichero(s) revisado(s) en packages/core/discovery, ninguno usa el patron new Map(... .map(... => [key, value])) con clave scanner-shaped`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
