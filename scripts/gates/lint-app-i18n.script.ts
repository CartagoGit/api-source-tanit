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
 *     nadie se entere.
 *  5. **Cada idioma es real.** Un locale tiene que estar en los
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

/**
 * Una llamada a `translate`.
 *
 * El punto delante de `translate` es lo que la distingue de la
 * **declaración** del método en el propio servicio: `translate(clave:
 * string)` no es una llamada, es la firma.
 */
const TRANSLATE_CALL = /\.translate\s*\(\s*([^)]*?)\s*\)/g;

/** Un `labelKey: "..."`: la clave de una etiqueta guardada en una lista. */
const LABEL_KEY = /\blabelKey\s*:\s*("[^"]+"|'[^']+')/g;

/** Una clave pedida, con el fichero que la pide. */
interface IRequest {
  readonly key: string;
  readonly file: string;
}

/** Quita las comillas de un literal. */
function unquote(literal: string): string {
  return literal.replace(/^["']/, "").replace(/["']$/, "");
}

/**
 * Si el argumento de `translate` es una clave literal.
 *
 * `null` cuando no lo es: o es una lista estática (`algo.labelKey`,
 * que se comprueba en los `labelKey:` de su declaración), o es una
 * clave construida en runtime, que el gate no puede verificar.
 */
function literalKey(argument: string): string | null {
  const trimmed = argument.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return unquote(trimmed);
  return null;
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

  // ── 5. Cada idioma es uno de los del producto ────────────────────
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
      if (!values.has(key)) problems.push({ file: `locales/${code}.json`, message: `falta la clave \`${key}\`` });
    }
    for (const key of values.keys()) {
      if (!reference.has(key)) problems.push({ file: `locales/${code}.json`, message: `la clave \`${key}\` no existe en \`${REFERENCE_LOCALE}.json\`` });
    }
  }

  // ── 2, 3 y 4. Lo que el código pide ──────────────────────────────
  const requests: IRequest[] = [];
  const sources = [
    ...(await collectFiles(APP_SRC, [".ts"])),
    ...(await collectFiles(APP_SRC, [".html"])),
  ];

  for (const source of sources) {
    const rel = relative(REPO_ROOT, source);
    const text = await readFile(source, "utf8");

    for (const match of text.matchAll(TRANSLATE_CALL)) {
      const argument = match[1] ?? "";
      const literal = literalKey(argument);
      if (literal !== null) {
        requests.push({ key: literal, file: rel });
        continue;
      }
      // `algo.labelKey` es una lista estática: sus claves se declaran
      // con `labelKey: "..."` y se comprueban allí.
      if (argument.trim().endsWith(".labelKey")) continue;
      problems.push({
        file: rel,
        message:
          `una clave construida en runtime no se puede comprobar: \`${argument.trim()}\`. ` +
          "Declárala en una lista con `labelKey: \"...\"` o pide una clave literal.",
      });
    }

    for (const match of text.matchAll(LABEL_KEY)) {
      const literal = match[1] ?? "";
      requests.push({ key: unquote(literal), file: rel });
    }
  }

  const asked = new Map<string, Set<string>>();
  for (const request of requests) {
    const files = asked.get(request.key) ?? new Set<string>();
    files.add(request.file);
    asked.set(request.key, files);
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
        "  lo dice por él: todas las claves, en todos los idiomas.",
    );
    return 1;
  }

  console.log(
    `lint:app-i18n — ${catalogs.size} idioma(s), ${reference.size} clave(s) en cada uno, ` +
      `${asked.size} clave(s) pedidas, ninguna huérfana`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
