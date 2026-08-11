/**
 * Carga los idiomas de la interfaz.
 *
 * ## Los dos orígenes, y por qué hacen falta los dos
 *
 * Los quince van **empaquetados** con un `import` estático, y además se
 * leen los ficheros de una carpeta del usuario si existe.
 *
 * No es redundancia: el binario compilado **no tiene sistema de
 * ficheros**. La página se sirve desde memoria (`UI_HTML`) precisamente
 * por eso, y un `readFile` sobre una carpeta de idiomas devolvería nada
 * dentro del `.deb`. Si solo hubiera ficheros, la aplicación de
 * escritorio se quedaría sin idiomas; si solo hubiera empaquetados, no
 * se podría añadir uno sin recompilar — que es justo lo que se pide.
 *
 * ## Un idioma externo gana al empaquetado
 *
 * Quien deja un `es.json` en su carpeta quiere corregir el que viene,
 * no que se le ignore. Al revés sería un fichero que no hace nada.
 *
 * ## Una clave que falte cae al inglés
 *
 * Clave a clave, no catálogo a catálogo. Un idioma al 80 % enseña el
 * 80 % traducido y el resto en inglés, en vez de descartarse entero o
 * —peor— enseñar la clave cruda (`settings.theme`) en la pantalla.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BUNDLED_LOCALES,
  FALLBACK_LOCALE,
} from "../../contracts/constants/cli/locales.constant.js";
import type {
  II18nCatalog,
  ILoadedLocale,
  ITranslations,
} from "../../contracts/interfaces/cli/i18n.interface.js";
import { parseJson } from "../../core/helpers/parse-json.helper.js";

import ar from "./locales/ar.json" with { type: "json" };
import bn from "./locales/bn.json" with { type: "json" };
import de from "./locales/de.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import hi from "./locales/hi.json" with { type: "json" };
import id from "./locales/id.json" with { type: "json" };
import ja from "./locales/ja.json" with { type: "json" };
import ko from "./locales/ko.json" with { type: "json" };
import pt from "./locales/pt.json" with { type: "json" };
import ru from "./locales/ru.json" with { type: "json" };
import tr from "./locales/tr.json" with { type: "json" };
import ur from "./locales/ur.json" with { type: "json" };
import zhHans from "./locales/zh-Hans.json" with { type: "json" };

/**
 * Los catálogos empaquetados, por código.
 *
 * Se enumeran a mano y no con un `import` dinámico porque el
 * empaquetador tiene que **verlos** para meterlos dentro del binario: un
 * `import(\`./locales/${code}.json\`)` se resuelve en ejecución, y en el
 * binario compilado no hay nada que resolver.
 *
 * `tests/cli/i18n.spec.ts` comprueba que este mapa y la carpeta digan lo
 * mismo, que es lo que impide que añadir un fichero y olvidarse de esta
 * línea pase desapercibido.
 */
const EMPAQUETADOS: Readonly<Record<string, ITranslations>> = {
  ar,
  bn,
  de,
  en,
  es,
  fr,
  hi,
  id,
  ja,
  ko,
  pt,
  ru,
  tr,
  ur,
  "zh-Hans": zhHans,
};

/** El catálogo de inglés, al que cae todo lo que falte. */
const BASE: ITranslations = en;

/** Rellena con inglés lo que el idioma no traiga. */
function conRespaldo(traducciones: ITranslations): ITranslations {
  return { ...BASE, ...traducciones };
}

function metadatos(code: string): { nativeName: string; rtl: boolean } {
  const conocido = BUNDLED_LOCALES.find((l) => l.code === code);
  return {
    // Un idioma externo que no está en el catálogo se nombra con su
    // código: es feo, pero es cierto, y es mejor que inventarse un
    // nombre o dejarlo en blanco.
    nativeName: conocido?.nativeName ?? code,
    rtl: conocido?.rtl ?? false,
  };
}

/**
 * Lee los idiomas de una carpeta del usuario.
 *
 * Un fichero que no se pueda leer o que no sea JSON **no rompe nada**:
 * se devuelve en `rejected` con su motivo. Un idioma roto que alguien
 * dejó ahí no puede impedir que la interfaz arranque, pero tampoco
 * puede desaparecer en silencio — si desapareciera, quien lo escribió
 * no tendría forma de saber por qué no sale en la lista.
 */
async function leerExternos(
  carpeta: string,
): Promise<{ locales: ILoadedLocale[]; rejected: II18nCatalog["rejected"] }> {
  const locales: ILoadedLocale[] = [];
  const rejected: Array<{ file: string; reason: string }> = [];

  let ficheros: string[];
  try {
    ficheros = (await readdir(carpeta)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    // La carpeta no existe, que es lo normal: nadie ha añadido idiomas.
    return { locales, rejected };
  }

  for (const fichero of ficheros) {
    const code = fichero.replace(/\.json$/, "");
    let crudo: string;
    try {
      crudo = await readFile(join(carpeta, fichero), "utf8");
    } catch (error) {
      rejected.push({
        file: fichero,
        reason: `could not be read: ${(error as Error).message}`,
      });
      continue;
    }

    const leido = parseJson(crudo);
    if (!leido.ok) {
      rejected.push({ file: fichero, reason: `is not valid JSON: ${leido.reason}` });
      continue;
    }
    if (typeof leido.value !== "object" || leido.value === null || Array.isArray(leido.value)) {
      rejected.push({
        file: fichero,
        reason: "must be a flat object of key → text",
      });
      continue;
    }

    const entradas = Object.entries(leido.value as Record<string, unknown>);
    const textos = entradas.filter(([, v]) => typeof v === "string");
    if (textos.length === 0) {
      rejected.push({ file: fichero, reason: "has no translatable text" });
      continue;
    }

    locales.push({
      code,
      ...metadatos(code),
      translations: conRespaldo(Object.fromEntries(textos) as ITranslations),
      origin: "external",
    });
  }

  return { locales, rejected };
}

/**
 * Todos los idiomas disponibles: los de dentro y los que haya fuera.
 *
 * `externalDir` es opcional porque en el navegador no hay carpeta que
 * leer, y porque los tests necesitan apuntar a la suya.
 */
export async function loadLocales(externalDir?: string): Promise<II18nCatalog> {
  const empaquetados: ILoadedLocale[] = BUNDLED_LOCALES.map((l) => ({
    code: l.code,
    nativeName: l.nativeName,
    rtl: l.rtl ?? false,
    translations: conRespaldo(EMPAQUETADOS[l.code] ?? {}),
    origin: "bundled" as const,
  }));

  if (externalDir === undefined) {
    return { locales: empaquetados, rejected: [] };
  }

  const { locales: externos, rejected } = await leerExternos(externalDir);

  // El externo gana: quien deja un `es.json` en su carpeta quiere
  // corregir el que viene, no que se le ignore.
  const porCodigo = new Map(empaquetados.map((l) => [l.code, l]));
  for (const externo of externos) porCodigo.set(externo.code, externo);

  return { locales: [...porCodigo.values()], rejected };
}

/**
 * Elige el mejor idioma disponible para lo que pide quien llega.
 *
 * `preferidos` es lo que dice el navegador (`navigator.languages`) o el
 * sistema (`LANG`), en orden de preferencia. Se prueban tres cosas por
 * cada uno, y ese orden es lo que hace que funcione de verdad:
 *
 *   1. **Coincidencia exacta**: `pt-BR` con `pt-BR`.
 *   2. **Solo el idioma**: `pt-BR` cae en `pt`. Alguien que pide
 *      portugués de Brasil prefiere portugués de Portugal a inglés.
 *   3. **La primera variante de ese idioma**: `zh` encuentra `zh-Hans`.
 *      El caso contrario del anterior, y sin él, pedir `zh` a secas
 *      caería al inglés teniendo chino disponible.
 *
 * Si nada casa, `FALLBACK_LOCALE`.
 */
export function pickLocale(
  preferidos: ReadonlyArray<string>,
  disponibles: ReadonlyArray<string>,
): string {
  const normalizados = disponibles.map((c) => c.toLowerCase());
  const indice = (buscado: string): number => normalizados.indexOf(buscado);

  for (const bruto of preferidos) {
    const pedido = bruto.trim().toLowerCase();
    if (pedido === "") continue;

    const exacto = indice(pedido);
    if (exacto !== -1) return disponibles[exacto]!;

    const base = pedido.split("-")[0] ?? pedido;
    const soloIdioma = indice(base);
    if (soloIdioma !== -1) return disponibles[soloIdioma]!;

    const variante = normalizados.findIndex((c) => c.startsWith(`${base}-`));
    if (variante !== -1) return disponibles[variante]!;
  }

  return FALLBACK_LOCALE;
}

/** El texto de una clave, cayendo al inglés y luego a la propia clave. */
export function translate(locale: ILoadedLocale, key: string): string {
  return locale.translations[key] ?? BASE[key] ?? key;
}

export { FALLBACK_LOCALE };
