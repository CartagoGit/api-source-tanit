#!/usr/bin/env bun
/**
 * `bun run lint:no-type-escapes` — que el compilador pueda contradecir.
 *
 * `as unknown as T` es una aserción que TypeScript **no puede
 * comprobar**: apaga exactamente la verificación que justifica tener
 * tipos. `as any` y `@ts-ignore`, lo mismo con menos ceremonia.
 *
 * Había veintiuno. Ninguno de los de producción hacía falta: los cuatro
 * tapaban una **declaración equivocada**, no un problema del código.
 *
 *   · `readdir` tenía las sobrecargas al revés → doce `as never`.
 *   · `IBufferLike` no decía extender `Uint8Array`, que es lo que un
 *     `Buffer` es → un `as unknown as Uint8Array`.
 *   · `BunSpawnSync` declaraba `ReadableStream` donde el modo síncrono
 *     devuelve bytes → dos más.
 *   · `ParsedRoute` no tenía `framework`, así que el scanner de OpenAPI
 *     coló `__params` con `as any` → dos más.
 *
 * Ese es el patrón y por eso importa el gate: **el casting no arregla
 * nada, esconde dónde está el fallo**. Los doce de `readdir` escondieron
 * durante meses un tipo que mentía, en el repo que activó
 * `noUncheckedIndexedAccess` justo para que eso no pasara.
 *
 * De los de tests, tres eran innecesarios —quitarlos tipa limpio— y el
 * resto construían objetos inválidos a propósito, que es lo que ahora
 * hace `tests/helpers/postman-builders.ts` diciendo qué le falta a cada
 * uno.
 *
 * Uso:
 *   bun run lint:no-type-escapes
 */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { collectFiles } from "../helpers/walk.helper.js";

/** Dónde se busca. */
const ROOTS = ["projects", "scripts", "tests"] as const;

/**
 * Los sitios donde una aserción es legítima, **con su motivo**.
 *
 * Una lista con motivos escritos es la diferencia entre una excepción y
 * una grieta: la siguiente persona lee por qué y decide si su caso se
 * parece, en vez de copiar el patrón porque «ya había otro».
 */
const PERMITIDOS: Readonly<Record<string, string>> = {
  "projects/plugins/mcp-vertex_expostman/tests/helpers/plugin-context.ts":
    "doble de test contra el McpServer del SDK: un tipo de terceros con decenas " +
    "de miembros del que solo se usa `registerTool`",
  "tests/helpers/postman-builders.ts":
    "construye items inválidos a propósito para los tests de invariantes, y " +
    "declara qué le falta a cada uno",
};

/** Las formas de apagar el compilador. */
const ESCAPES: ReadonlyArray<{ readonly pattern: RegExp; readonly what: string }> = [
  { pattern: /\bas\s+unknown\s+as\b/, what: "as unknown as" },
  { pattern: /\bas\s+any\b/, what: "as any" },
  { pattern: /\bas\s+never\b/, what: "as never" },
  { pattern: /@ts-ignore/, what: "@ts-ignore" },
  { pattern: /@ts-expect-error/, what: "@ts-expect-error" },
];

/**
 * Lo que este gate **todavía no** vigila: la anotación `: any` suelta.
 *
 * Se midió: 35 sitios, 9 de ellos en scanners de producción, casi todos
 * `let parsed: any` sobre un `JSON.parse`. Es deuda real y de la misma
 * familia —así entró `__params`—, pero convertirlos a `unknown` obliga a
 * estrechar cada uso aguas abajo, y eso es un refactor con su propio
 * riesgo, no un remate. Va en r00006 con la cifra delante.
 *
 * Lo que sí vigila son las **aserciones**, que es lo que la auditoría
 * encontró: `as any` miente sobre un valor concreto en un punto
 * concreto, mientras que `: any` es una declaración honesta de que ahí
 * todavía no se sabe el tipo.
 */

interface IProblem {
  readonly file: string;
  readonly line: number;
  readonly what: string;
  readonly source: string;
}

/** ¿La línea es prosa? Los comentarios explican estos castings, no los usan. */
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
      // Los fixtures son código de OTROS proyectos: la entrada de los
      // scanners, no código de este repo.
      if (rel.includes("fixtures/")) continue;
      // Este fichero contiene los patrones que busca: encontrarse a sí
      // mismo sería un gate que nunca puede pasar.
      if (rel.endsWith("lint-no-type-escapes.script.ts")) continue;
      revisados += 1;

      const lines = (await readFile(file, "utf8")).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (esComentario(line)) continue;
        for (const { pattern, what } of ESCAPES) {
          if (pattern.test(line)) {
            problems.push({ file: rel, line: i + 1, what, source: line.trim() });
            break;
          }
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(`lint:no-type-escapes — ${problems.length} aserción(es):\n`);
    for (const p of problems) {
      console.error(`  ✗ ${p.file}:${p.line} — ${p.what}`);
      console.error(`      ${p.source}`);
    }
    console.error(
      "\n  Un casting no arregla nada: esconde dónde está el fallo. Los cuatro\n" +
        "  de producción que hubo tapaban una **declaración equivocada**, no un\n" +
        "  problema del código — mira ahí primero.\n" +
        "\n  Si de verdad hace falta (un tipo de terceros que no controlas),\n" +
        "  decláralo en `PERMITIDOS` de este mismo fichero, con el motivo.",
    );
    return 1;
  }

  console.log(
    `lint:no-type-escapes — ${revisados} ficheros, ${Object.keys(PERMITIDOS).length} ` +
      "aserciones declaradas con motivo, ninguna suelta",
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
