#!/usr/bin/env bun
/**
 * `bun run lint:no-raw-json-parse` — que parsear JSON ajeno sea por el helper.
 *
 * La auditoría de 2026-09-03 (`a00009` / BUG-003) midió cuatro
 * scanners —fastify, graphql, hono, trpc— que leían su `package.json`
 * con `JSON.parse(await readFile(...))` directo, sin pasar por
 * `parseJson` de `packages/core/helpers/parse-json.helper.ts`. El
 * patrón silenciaba el caso "JSON corrupto": un manifest con BOM, un
 * comentario trailing o una coma colgante reventaba el scan con
 * `SyntaxError: Unexpected token` en vez de devolver el contrato
 * `{ ok: false, reason }` que el resto del pipeline sí distingue.
 *
 * El helper existe justamente para eso: `parseJson` devuelve
 * `{ ok: true, value }` o `{ ok: false, reason }`, así que el código
 * downstream puede preguntar antes de usar, y `unknown` impide que un
 * `any` se cuele en el resto del scanner.
 *
 * Este gate detecta el patrón en los caminos donde se lee *dato de
 * otro* (user-data paths: `frameworks/scanners/`,
 * `plugins/<name>/src/lib/helpers/`) y rechaza cualquier `JSON.parse`
 * cuyo argumento sea una lectura de fichero. Si lo necesitas por un
 * motivo real, decláralo en `PERMITIDOS` con la razón.
 *
 * Uso:
 *   bun run lint:no-raw-json-parse
 */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { collectFiles } from "../helpers/walk.helper.js";

/**
 * Dónde buscar. Cada raíz es una zona donde se lee JSON ajeno:
 * los scanners parsean manifiestos de usuario, los helpers del plugin
 * parsean respuestas de la API que también pueden llegar mal.
 *
 * Los tests no entran en el alcance: pueden necesitar `JSON.parse`
 * directo para verificar que un helper hace lo que dice, y no son
 * código que se ejecute en producción.
 */
const ROOTS = [
  "packages/frameworks/scanners",
  "packages/plugins/delendai_expostman/src",
] as const;

/**
 * Sitios donde el patrón es legítimo, **con motivo escrito**.
 *
 * Una entrada con motivo es la diferencia entre una excepción y una
 * grieta: la siguiente persona lee por qué, no copia el patrón porque
 * «ya había otro».
 */
const PERMITIDOS: Readonly<Record<string, string>> = {};

interface IProblem {
  readonly file: string;
  readonly line: number;
  readonly source: string;
}

/** Comentarios documentan el patrón; no lo ejercen. */
function esComentario(line: string): boolean {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

async function main(): Promise<number> {
  const problems: IProblem[] = [];
  let revisados = 0;

  for (const root of ROOTS) {
    for (const file of await collectFiles(fromRoot(root), [".ts"])) {
      const rel = relative(REPO_ROOT, file);
      if (PERMITIDOS[rel] !== undefined) continue;
      // Este fichero contiene el patrón que busca: encontrarse a sí
      // mismo sería un gate que nunca puede pasar.
      if (rel.endsWith("lint-no-raw-json-parse.script.ts")) continue;
      revisados += 1;

      const source = await readFile(file, "utf8");
      // El patrón busca `JSON.parse` cuyo argumento sea, inmediata o
      // diferidamente, una lectura de fichero. Esto cubre las dos
      // formas que tenían los scanners antes:
      //
      //   JSON.parse(await readFile(path, "utf8"))
      //   const raw = await readFile(path, "utf8");
      //   return JSON.parse(raw);
      //
      // Para distinguirlas: si la línea del `JSON.parse` ya contiene
      // un `readFile`, caso cerrado; si no, se mira el bloque de
      // 12 líneas anteriores (la asignación `raw` siempre está arriba
      // por la forma típica de los detectores) y se exige ver un
      // `readFile(` en ese tramo — eso descarta los `JSON.parse`
      // sobre literales (`JSON.parse('{"a":1}')`) y los que validan
      // un valor ya en memoria.
      const lines = source.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (esComentario(line)) continue;
        if (!/JSON\.parse\s*\(/.test(line)) continue;
        const contexto = lines
          .slice(Math.max(0, i - 12), i + 1)
          .join("\n");
        if (!/readFile(?:Sync)?\s*\(/.test(contexto)) continue;
        problems.push({ file: rel, line: i + 1, source: line.trim() });
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      `lint:no-raw-json-parse — ${problems.length} parse(s) directo(s) sobre readFile:\n`,
    );
    for (const p of problems) {
      console.error(`  ✗ ${p.file}:${p.line}`);
      console.error(`      ${p.source}`);
    }
    console.error(
      "\n  `JSON.parse(await readFile(...))` directo silencia los manifests\n" +
        "  malformados: reventaba el scan con `SyntaxError: Unexpected token`\n" +
        "  en vez de devolver `{ ok: false, reason }`. El helper\n" +
        "  `packages/core/helpers/parse-json.helper.ts` ya distingue ese\n" +
        "  caso de un JSON que legítimamente contiene `null`, y `isRecord`\n" +
        "  reemplaza el `as Record<string, unknown>` que viajaba con el\n" +
        "  parseo.\n" +
        "\n  Si de verdad hace falta (p.ej. parsing de un JSON con `JSON5`\n" +
        "  o un superjson), decláralo en `PERMITIDOS` con el motivo.",
    );
    return 1;
  }

  console.log(
    `lint:no-raw-json-parse — ${revisados} ficheros, ${Object.keys(PERMITIDOS).length} ` +
      "excepción(es) declarada(s), ninguna suelta",
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
