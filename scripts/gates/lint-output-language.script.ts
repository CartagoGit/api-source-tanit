#!/usr/bin/env bun
/**
 * `bun run lint:output-language` — la salida habla un solo idioma.
 *
 * El CLI hablaba **los dos a la vez**, y a veces en la misma ejecución:
 * `generate` decía `→ Enriching with validation-rule variants…` y, si
 * fallaba, `✗ No se ha encontrado ningún endpoint`. No rompía nada —
 * hacía que la herramienta pareciera dos herramientas.
 *
 * El idioma elegido es el **inglés**, y no por gusto: el README, el
 * `--help` y el paquete publicado ya lo hablan. Lo que ve quien usa la
 * herramienta es superficie de producto, y una superficie no puede
 * contradecirse consigo misma.
 *
 * ## Lo que NO se toca
 *
 * Los comentarios y la documentación interna siguen en español, y es
 * deliberado: los escribe y los lee quien mantiene esto. Este gate mira
 * **solo literales dentro de llamadas a `console`**, que es exactamente
 * la frontera entre lo interno y lo que sale por pantalla.
 *
 * ## Por qué no hay un módulo de mensajes
 *
 * Se midió: 181 llamadas a `console`, de las que 41 estaban en español.
 * Un módulo de strings para 181 mensajes dinámicos es un sistema de i18n
 * a medias, y `r00003` lo descarta expresamente en sus no-objetivos: son
 * doce comandos, no un producto multilenguaje. Traducir y poner un gate
 * cuesta menos y sostiene igual.
 *
 * Uso:
 *   bun run lint:output-language
 */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { collectFiles } from "../helpers/walk.helper.js";

/**
 * Marcas inequívocas de español.
 *
 * Solo palabras que en inglés no existen o no significan lo mismo. Se
 * dejan fuera las ambiguas —`no`, `error`, `final`, `total`— porque un
 * gate con falsos positivos se acaba desactivando, y entonces no
 * sostiene nada.
 */
const MARCAS_ES = [
  /[¿¡]/,
  /\b(?:ning[uú]n|ninguna|colecci[oó]n|colecciones)\b/i,
  /\b(?:se ha|se han|no se|se puede|se pudo)\b/i,
  /\b(?:est[aá]|est[aá]n|hay|desde|hasta|para|con|sin|del|los|las|una|unos|unas)\b/i,
  /\b(?:qu[eé]|c[oó]mo|d[oó]nde|porque|pero|tambi[eé]n|adem[aá]s)\b/i,
  /\b(?:generad[oa]s?|escrit[oa]s?|detectad[oa]s?|encontrad[oa]s?|cread[oa]s?)\b/i,
  /\b(?:carpeta|fichero|archivo|ruta|rutas|proyecto|siguiente|paso|prueba)\b/i,
  /\b(?:vigilando|abriendo|leyendo|escribiendo|comprueba|ejecuta|pasa|mira)\b/i,
  // Los sustantivos que se colaron la primera vez. Un `✔ Interfaz en
  // http://…` pasó el gate entero porque ninguna marca lo cubría: la
  // lista de marcas es la parte del gate que hay que ampliar cuando algo
  // se escapa, y esto es lo que se escapó.
  /\b(?:interfaz|generaci[oó]n|creaci[oó]n|validaci[oó]n|configuraci[oó]n)\b/i,
  /\b(?:resumen|salida|entrada|puerto|equipo|p[aá]gina|cerrando|abortada)\b/i,
];

/** Dónde vive la salida que ve quien usa la herramienta. */
const AREAS = ["packages/cli", "packages/ui", "packages/core/helpers"] as const;

/**
 * Dónde vive un mensaje de usuario.
 *
 * `console.*` es lo evidente. `reason` y `nextAction` van con ellos
 * porque son la forma canónica de un error accionable en este proyecto:
 * salen por el CLI **y** viajan al agente por el sobre de `toolError`.
 * Dejarlos fuera del gate era el hueco por el que se escapó
 * `collection-file.helper`, que vive en `core/` y habla por pantalla.
 */
const LLAMADA = /(?:console\.(?:log|error|warn|info)\(|(?:reason|nextAction):\s*)([\s\S]*?)(?:\);|,\n)/g;
const LITERAL = /"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

/**
 * Quita comentarios.
 *
 * La prosa interna en español es una decisión del proyecto y se queda;
 * sin esto, el gate acusaría a cada docblock del repositorio.
 */
function sinComentarios(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat(m.split("\n").length - 1))
    .replace(/^\s*\/\/.*$/gm, "");
}

interface IProblem {
  readonly file: string;
  readonly line: number;
  readonly texto: string;
}

async function main(): Promise<number> {
  const problems: IProblem[] = [];
  let revisados = 0;
  let mensajes = 0;

  for (const area of AREAS) {
    for (const file of await collectFiles(fromRoot(area), [".ts"])) {
      const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
      const source = sinComentarios(await readFile(file, "utf8"));
      if (!/console\.|reason:|nextAction:/.test(source)) continue;
      revisados++;

      LLAMADA.lastIndex = 0;
      for (const llamada of source.matchAll(LLAMADA)) {
        const cuerpo = llamada[1] ?? "";
        for (const lit of cuerpo.matchAll(LITERAL)) {
          const texto = lit[1] ?? lit[2] ?? "";
          if (texto.length < 6) continue;
          mensajes++;
          if (!MARCAS_ES.some((re) => re.test(texto))) continue;
          const antes = source.slice(0, (llamada.index ?? 0) + (lit.index ?? 0));
          problems.push({
            file: rel,
            line: antes.split("\n").length,
            texto: texto.slice(0, 80),
          });
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      `lint:output-language — ${problems.length} mensaje(s) que no están en inglés:\n`,
    );
    for (const p of problems) {
      console.error(`  ✗ ${p.file}:${p.line}\n      "${p.texto}"`);
    }
    console.error(
      "\n  La salida del CLI habla inglés: el README, el `--help` y el paquete\n" +
        "  publicado ya lo hacen, y una superficie de producto no puede\n" +
        "  contradecirse consigo misma. `generate` llegó a decir\n" +
        "  `→ Enriching with…` y, al fallar, `✗ No se ha encontrado…`.\n" +
        "\n  Los comentarios y la documentación interna siguen en español: eso\n" +
        "  es deliberado y este gate no los mira.",
    );
    return 1;
  }

  console.log(
    `lint:output-language — ${mensajes} mensajes en ${revisados} ficheros, todos en inglés`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
