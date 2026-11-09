#!/usr/bin/env bun
/**
 * `bun run lint:app-i18n` — los catálogos de la app y el código que los usa.
 *
 * ## Por qué existe
 *
 * La app ofrecía un idioma que **no existía**. El selector no estaba
 * en ninguna parte: la única forma de cambiar el idioma era escribir
 * en el almacenamiento del navegador a mano, y aun así cambiaba cuatro
 * cadenas deciento cincuenta. El resto estaba en inglés escrito dentro
 * de la plantilla.
 *
 * Un selector de idioma que no cambia nada es peor que no tenerlo:
 * le dice a la persona que la app habla su idioma cuando no lo habla.
 *
 * ## Qué comprueba
 *
 *  1. **Paridad de claves.** Todos los catálogos tienen exactamente
 *     las mismas claves que el de referencia (`en.json`). Un locale
 *     con una clave menos es un texto que sale en crudo.
 *  2. **Toda clave pedida existe.** Si el código pide una clave que
 *     ningún catálogo tiene, en pantalla sale la clave: `endpoints.loading`
 *     en vez de una palabra.
 *  3. **Ninguna clave huérfana.** Si el catálogo tiene una clave que
 *     nadie pide, el catálogo está mintiendo sobre lo que la app dice.
 *  4. **Las claves son estáticas.** Una clave construida en runtime
 *     (`nav.${seccion}`) no se puede comprobar, y una clave que no se
 *     puede comprobar es una clave que se puede equivocar sin que
 *     nadie se entere. La excepción es un mapa declarado con claves
 *     literales: el conjunto de claves es conocido aunque la que se
 *     elija dependa de lo que esté en pantalla.
 *  5. **Ningún texto fijo en las plantillas.** Una palabra escrita
 *     entre etiquetas no se traduce: sale en inglés aunque el idioma
 *     sea el español. Es el fallo que más se cuela, porque la
 *     plantilla se ve bien en el navegador y nadie lo nota hasta que
 *     alguien lee la app en otro idioma.
 *  6. **Cada idioma es real.** Un locale tiene que estar en los
 *     `BUNDLED_LOCALES` del producto: la app y la interfaz del
 *     binario ofrecen los mismos idiomas.
 *
 * ## Por qué un gate y no una revisión manual
 *
 * Porque el olvido no es de quien escribe el catálogo, es de quien
 * escribe el código **después**. El catálogo se queda viejo en
 * silencio: nadie ve que falta una traducción hasta que alguien la
 * busca en pantalla y lee `settings.keychain` en vez de una frase.
 *
 * Uso:
 *   bun run lint:app-i18n
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { BUNDLED_LOCALES } from "../../packages/contracts/constants/cli/locales.constant.js";
import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";
import { collectFiles } from "../helpers/walk.helper.js";

/** La app Angular: todo lo que pide palabras vive aquí. */
const APP_SRC = fromRoot("packages/app/src");

/** Los catálogos de la app. */
const LOCALES_DIR = join(APP_SRC, "app/core/i18n/locales");

/** El catálogo de referencia: el inglés, la lengua de partida. */
const REFERENCE_LOCALE = "en";

/** Un problema encontrado, con dónde está. */
interface IProblem {
  readonly file: string;
  readonly message: string;
}

/** Un `labelKey: "..."`: la clave de una etiqueta guardada en una lista. */
const LABEL_KEY = /\blabelKey\s*:\s*("[^"]*"|'[^']*')/g;

/** Un mapa de claves literales: `Record<string, string>`. */
const MAP_DECLARATION = /(\w+)\s*:\s*(?:Readonly<)?Record<string,\s*string>/g;

/** Una palabra suelta dentro de un texto: `Overwrite`. */
const WORD = /[A-Za-z]{2,}/;

/**
 * Los argumentos de cada llamada a `translate`.
 *
 * Se cuentan los paréntesis, porque el argumento puede traerlos:
 * `translate("x", { count: f(1) })` cierra donde cierra de verdad, no
 * en el primer `)`.
 */
function argumentsOf(text: string, method: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`\\b${method}\\s*\\(`, "g");
  let match = pattern.exec(text);
  while (match !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let index = start;
    while (index < text.length && depth > 0) {
      const char = text[index];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      index += 1;
    }
    out.push(text.slice(start, Math.max(start, index - 1)));
    pattern.lastIndex = index;
    match = pattern.exec(text);
  }
  return out;
}

/** Los literales de cadena de un texto: `"a"` y `'a'`. */
function literalsOf(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? "");
}

/**
 * Los mapas de claves literales declarados en un fichero.
 *
 * Con su nombre y las claves que guardan: el gate necesita las dos
 * cosas para aceptar una clave que se elige en runtime y para saber
 * qué claves existen de verdad.
 */
function staticMaps(text: string): Map<string, string[]> {
  const maps = new Map<string, string[]>();
  const pattern = new RegExp(MAP_DECLARATION.source, "g");
  let match = pattern.exec(text);
  while (match !== null) {
    const name = match[1] ?? "";
    const open = text.indexOf("{", match.index + match[0].length);
    if (open !== -1) {
      let depth = 0;
      let index = open;
      while (index < text.length) {
        if (text[index] === "{") depth += 1;
        else if (text[index] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
        index += 1;
      }
      maps.set(name, literalsOf(text.slice(open, index)));
    }
    match = pattern.exec(text);
  }
  return maps;
}

/**
 * El texto de un fichero TypeScript, sin sus comentarios.
 *
 * Un comentario que explica una traducción (`translate(...)`) es
 * documentación, no una llamada: contarlo como llamada sería un
 * falso positivo, y un gate con falsos positivos se acaba
 * desactivando.
 */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
}

/**
 * El texto que la plantilla escribe en la pantalla.
 *
 * Se quitan los bloques de control de flujo de Angular (`@if`,
 * `@for`, `@switch`…), las interpolaciones, los scripts y los
 * comentarios; lo que queda entre etiquetas es lo que la persona
 * lee.
 */
function visibleText(html: string): string[] {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/\{\{[\s\S]*?\}\}/g, " ");
  text = text.replace(
    /@(?:if|else|for|empty|switch|case|default|let|defer|placeholder|loading|error)\b[^<{]*/g,
    " ",
  );
  text = text.replace(/[{}]/g, " ");
  return [...text.matchAll(/>([^<>]+)</g)]
    .map((m) => (m[1] ?? "").trim())
    .filter((node) => WORD.test(node));
}

async function main(): Promise<number> {
  const problems: IProblem[] = [];

  // ── Los catálogos ────────────────────────────────────────────────
  const entries = (await readdir(LOCALES_DIR)).filter((name) => name.endsWith(".json")).sort();
  if (entries.length === 0) {
    console.error("lint:app-i18n — la app no tiene catálogos de idioma.");
    return 1;
  }

  const catalogs = new Map<string, Map<string, string>>();
  for (const name of entries) {
    const path = join(LOCALES_DIR, name);
    const rel = relative(REPO_ROOT, path);
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const values = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        problems.push({ file: rel, message: `\`${key}\` no es un texto.` });
        continue;
      }
      if (value.trim() === "") {
        problems.push({ file: rel, message: `\`${key}\` está vacío.` });
        continue;
      }
      values.set(key, value);
    }
    catalogs.set(name.replace(/\.json$/, ""), values);
  }

  const reference = catalogs.get(REFERENCE_LOCALE);
  if (!reference) {
    console.error(`lint:app-i18n — falta el catálogo de referencia \`${REFERENCE_LOCALE}.json\`.`);
    return 1;
  }

  // ── 6. Cada idioma es uno de los del producto ────────────────────
  const known = new Set(BUNDLED_LOCALES.map((locale) => locale.code));
  for (const code of catalogs.keys()) {
    if (!known.has(code)) {
      problems.push({
        file: relative(REPO_ROOT, join(LOCALES_DIR, `${code}.json`)),
        message: `el idioma \`${code}\` no está en los \`BUNDLED_LOCALES\` del producto`,
      });
    }
  }

  // ── 1. Paridad de claves ─────────────────────────────────────────
  for (const [code, values] of catalogs) {
    if (code === REFERENCE_LOCALE) continue;
    for (const key of reference.keys()) {
      if (!values.has(key)) {
        problems.push({ file: `locales/${code}.json`, message: `falta la clave \`${key}\`` });
      }
    }
    for (const key of values.keys()) {
      if (!reference.has(key)) {
        problems.push({
          file: `locales/${code}.json`,
          message: `la clave \`${key}\` no existe en \`${REFERENCE_LOCALE}.json\``,
        });
      }
    }
  }

  // ── 2, 3 y 4. Lo que el código pide ──────────────────────────────
  const asked = new Map<string, Set<string>>();
  const typescript = await collectFiles(APP_SRC, [".ts"]);
  const templates = await collectFiles(APP_SRC, [".html"]);

  /** Apunta una clave pedida al fichero que la pide. */
  const ask = (key: string, file: string): void => {
    const files = asked.get(key) ?? new Set<string>();
    files.add(file);
    asked.set(key, files);
  };

  for (const source of typescript) {
    const rel = relative(REPO_ROOT, source);
    const text = withoutComments(await readFile(source, "utf8"));
    // La maquinaria del idioma se excluye: ahí `translate` es la
    // declaración de la función, no una petición de una palabra.
    if (rel.includes("core/i18n/")) continue;
    const maps = staticMaps(text);

    for (const argument of argumentsOf(text, "translate")) {
      const literals = literalsOf(argument);
      if (literals.length > 0) {
        for (const literal of literals) ask(literal, rel);
        continue;
      }
      // `algo.labelKey` es una lista estática: sus claves se declaran
      // con `labelKey: "..."` y se comprueban allí.
      if (argument.trim().endsWith(".labelKey")) continue;
      // Un mapa declarado con claves literales: el conjunto de claves
      // es conocido, aunque la que se elija dependa de la pantalla.
      const map = [...maps.entries()].find(([name]) => argument.includes(name));
      if (map !== undefined) {
        for (const key of map[1]) ask(key, rel);
        continue;
      }
      problems.push({
        file: rel,
        message:
          `una clave construida en runtime no se puede comprobar: \`${argument.trim()}\`. ` +
          'Declárala en un mapa `Record<string, string>` o pide una clave literal.',
      });
    }

    for (const match of text.matchAll(LABEL_KEY)) {
      ask((match[1] ?? "").replace(/^["']/, "").replace(/["']$/, ""), rel);
    }
  }

  for (const template of templates) {
    const rel = relative(REPO_ROOT, template);
    const text = await readFile(template, "utf8");

    for (const argument of argumentsOf(text, "translate")) {
      for (const literal of literalsOf(argument)) ask(literal, rel);
    }

    // ── 5. Ningún texto fijo en la plantilla ───────────────────────
    // Solo las plantillas de los componentes: el `index.html` es el
    // documento, y el nombre de la marca en `<title>` no se traduce.
    if (!template.endsWith(".component.html")) continue;
    for (const node of visibleText(text)) {
      problems.push({
        file: rel,
        message: `texto fijo en la plantilla: \`${node}\` — va en el catálogo`,
      });
    }
  }

  for (const [key, files] of asked) {
    if (reference.has(key)) continue;
    problems.push({
      file: [...files][0] ?? "packages/app/src",
      message: `la clave \`${key}\` no existe en \`${REFERENCE_LOCALE}.json\``,
    });
  }

  for (const key of reference.keys()) {
    if (asked.has(key)) continue;
    problems.push({
      file: `locales/${REFERENCE_LOCALE}.json`,
      message: `la clave \`${key}\` no la pide nadie — está huérfana`,
    });
  }

  if (problems.length > 0) {
    console.error(`lint:app-i18n — ${problems.length} problema(s) en los catálogos de la app:\n`);
    for (const problem of problems) {
      console.error(`  ✗ ${problem.file}`);
      console.error(`      ${problem.message}`);
    }
    console.error(
      "\n  Los catálogos se quedan viejos en silencio: quien añade una\n" +
        "  palabra a la pantalla no sabe que hay que traducirla. El gate\n" +
        "  lo dice por él: todas las claves, en todos los idiomas, y ni\n" +
        "  una palabra escrita fuera del catálogo.",
    );
    return 1;
  }

  console.log(
    `lint:app-i18n — ${catalogs.size} idioma(s), ${reference.size} clave(s) en cada uno, ` +
      `${asked.size} clave(s) pedidas, ninguna huérfana, ningún texto fijo`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
