#!/usr/bin/env bun
/**
 * `bun run docs:api` — la referencia de lo que se puede importar.
 *
 * No es un sitio de documentación. La propuesta pedía TypeDoc publicado
 * en GitHub Pages, y eso son **dos** sitios donde vive la misma
 * información: los docblocks del código y una copia generada en otro
 * dominio. La copia es la que se queda vieja, y encima nadie la mira
 * porque el producto principal de este paquete es un CLI —para eso está
 * `expostman --help`, que se genera del propio dispatcher.
 *
 * Lo que sí falta es un índice de lo **importable**: el `exports` del
 * `package.json` deja entrar `./core/*` y `./frameworks`, y hasta ahora
 * no había forma de saber qué hay ahí sin abrir las carpetas.
 *
 * Así que se genera un solo `docs/API.md` desde el código, con
 * `--check` para que un gate avise si se ha quedado atrás. Es el mismo
 * trato que `mcp:sync`: generado, versionado y comprobado, que es lo que
 * impide que mienta.
 *
 * Uso:
 *   bun run docs:api            # escribe docs/API.md
 *   bun run docs:api --check    # falla si está desactualizado
 */
import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { publicFiles } from "../gates/lint-tsdoc.script.js";

const OUTPUT = fromRoot("docs", "API.md");

/** Un `export` de nivel superior con su documentación. */
interface IExportedSymbol {
  readonly kind: string;
  readonly name: string;
  readonly signature: string;
  readonly doc: string;
}

const EXPORT_RE =
  /^export\s+(?:declare\s+)?(?:async\s+)?(function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

/** El docblock que hay justo encima, ya sin los asteriscos. */
function docAbove(lines: ReadonlyArray<string>, index: number): string {
  let i = index - 1;
  while (i >= 0 && ((lines[i] ?? "").trim() === "" || (lines[i] ?? "").trim().startsWith("@"))) i--;
  if (i < 0 || !(lines[i] ?? "").trim().endsWith("*/")) return "";
  const end = i;
  while (i >= 0 && !(lines[i] ?? "").trim().startsWith("/**")) i--;
  if (i < 0) return "";
  return lines
    .slice(i + 1, end)
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}

/**
 * La firma en una línea.
 *
 * Para una función se recorta en el `{` del cuerpo; para una interfaz o
 * una clase, en la llave de apertura. Lo que interesa es cómo se llama,
 * no cómo está hecha.
 */
function signatureAt(lines: ReadonlyArray<string>, index: number): string {
  const collected: string[] = [];
  for (let i = index; i < Math.min(index + 8, lines.length); i++) {
    const line = (lines[i] ?? "").trim();
    collected.push(line);
    const joined = collected.join(" ");
    if (/[{;]\s*$/.test(line) || joined.includes("{")) {
      return joined.replace(/\s*\{.*$/, "").replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
    }
  }
  return collected.join(" ").replace(/\s+/g, " ").trim();
}

/** El docblock del propio módulo: el primero del fichero. */
function moduleDoc(source: string): string {
  const match = /^\/\*\*([\s\S]*?)\*\//.exec(source.trimStart());
  if (!match) return "";
  const body = (match[1] ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
  // Solo el primer párrafo: el resto suele ser la historia del fichero,
  // que es valiosa donde está y demasiada aquí.
  return (body.split(/\n\s*\n/)[0] ?? "").replace(/\s*\n\s*/g, " ").trim();
}

async function build(): Promise<string> {
  const files = (await publicFiles()).sort();
  const sections: string[] = [];
  let symbolCount = 0;

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    const source = await readFile(file, "utf8");
    const lines = source.split("\n");

    const symbols: IExportedSymbol[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = EXPORT_RE.exec(lines[i] ?? "");
      if (!match) continue;
      symbols.push({
        kind: match[1] ?? "",
        name: match[2] ?? "",
        signature: signatureAt(lines, i),
        doc: docAbove(lines, i),
      });
    }
    if (symbols.length === 0) continue;
    symbolCount += symbols.length;

    const summary = moduleDoc(source);
    sections.push(
      `### \`${rel}\`\n` +
        (summary ? `\n${summary}\n` : "") +
        symbols
          .map(
            (s) =>
              `\n#### \`${s.name}\`\n\n` +
              "```ts\n" +
              `${s.signature}\n` +
              "```\n" +
              (s.doc ? `\n${s.doc}\n` : ""),
          )
          .join(""),
    );
  }

  return [
    "<!--",
    "  GENERADO por `bun run docs:api`. No se edita a mano.",
    "  `bun run lint:api` comprueba que sigue al día.",
    "-->",
    "",
    "# Referencia de la API importable",
    "",
    "Lo que el `exports` del `package.json` deja importar desde fuera del",
    "paquete. Todo lo demás es interno y puede cambiar sin aviso.",
    "",
    "```ts",
    'import { generateWithAllFrameworks } from "export-to-postman/frameworks";',
    'import { buildCollection } from "export-to-postman/core/domain/collection-builder.service";',
    "```",
    "",
    "Si lo que buscas es la herramienta de línea de comandos y no la",
    "librería, `expostman --help` lista los comandos y las banderas.",
    "",
    `> ${symbolCount} símbolos en ${sections.length} módulos.`,
    "",
    ...sections,
  ].join("\n");
}

async function main(): Promise<number> {
  const content = await build();

  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = await readFile(OUTPUT, "utf8");
    } catch {
      console.error("lint:api — falta docs/API.md. Ejecuta `bun run docs:api`.");
      return 1;
    }
    if (current.trim() !== content.trim()) {
      console.error(
        "lint:api — docs/API.md no coincide con el código.\n" +
          "  Ejecuta `bun run docs:api` y comitea el resultado.",
      );
      return 1;
    }
    console.log("lint:api — docs/API.md al día con el área pública");
    return 0;
  }

  await writeFile(OUTPUT, content + "\n", "utf8");
  console.log(`docs:api — escrito ${relative(REPO_ROOT, OUTPUT)}`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
