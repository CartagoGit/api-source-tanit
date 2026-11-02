import { signal } from "@angular/core";

import {
  BUNDLED_LOCALES,
  FALLBACK_LOCALE,
} from "../../../../../contracts/constants/cli/locales.constant";
import type { ILocale } from "../../../../../contracts/constants/cli/locales.constant";

import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";

/**
 * The app's languages, and the words in them.
 *
 * ## What was wrong
 *
 * The app offered a language that **did not exist**. The screen had
 * no selector at all — the only way to change the language was to
 * write in the browser's storage — and even then it changed four
 * strings out of a hundred and fifty. Everything else was English
 * written in the template.
 *
 * A language switch that changes nothing is worse than no switch:
 * it says the app speaks your language when it does not.
 *
 * ## What it is now
 *
 * Every word the app shows comes from a catalog. The catalogs are
 * complete: the gate `bun run lint:app-i18n` fails if a locale is
 * missing a key, if the app asks for a key no locale has, if a
 * catalog carries a key nobody asks for, or if a template writes a
 * word outside the catalog.
 *
 * The **list** of languages is the product's, not the app's: the
 * same `BUNDLED_LOCALES` the interface inside the binary uses, with
 * each language named in its own language. The app ships the ones it
 * has a catalog for; adding a language is dropping a file in
 * `locales/` and re-running the gate.
 *
 * ## Why the state lives here and not in the service
 *
 * Because the **transport** needs it too. The bridge that talks to
 * the desktop sidecar throws errors the screen shows, and those
 * errors are words too. If the words only lived in an injectable
 * service, every client would have to inject it — and a client
 * built with `new` (which is how the tests build them) has no
 * injection context, so the error would say `NG0203` instead of what
 * went wrong.
 *
 * The language is therefore a module-level signal: one truth, read
 * from anywhere, with no context needed. The service is the thin
 * layer on top that remembers the choice and tells the document
 * about it.
 */

/** A catalog: key → the word, in one language. */
type Catalog = Readonly<Record<string, string>>;

/** The catalogs the app ships, by language code. */
const CATALOGS: Readonly<Record<string, Catalog>> = { en, es, fr };

/**
 * The language in use.
 *
 * A signal, so the screens that read it follow it: change the
 * language and everything drawn from a catalog changes with it.
 */
export const locale = signal<string>(FALLBACK_LOCALE);

/**
 * The word for a key, in the language in use.
 *
 * It falls back to English, and then to the key itself. Returning
 * the key is deliberate: a missing translation then reads as
 * `endpoints.loading` on the screen — obvious — instead of a dash,
 * which looks like a value that happens to be empty.
 *
 * The `values` fill the holes the catalog leaves: `{count}` is
 * replaced by the count. A sentence with a number in it cannot be
 * a plain word — "3 parameter" is not English and "3 parámetros"
 * is not either — so the numbers come from the code and the words
 * from the catalog.
 */
export function translate(
  key: string,
  values?: Readonly<Record<string, string | number>>,
): string {
  const catalog = CATALOGS[locale()] ?? CATALOGS[FALLBACK_LOCALE] ?? {};
  const template = catalog[key] ?? CATALOGS[FALLBACK_LOCALE]?.[key] ?? key;
  if (values === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (hole, name: string) =>
    name in values ? String(values[name]) : hole,
  );
}

/**
 * Changes the language.
 *
 * It says whether it did: a language the app has no catalog for is
 * not a language the app can speak, and pretending otherwise is how
 * the screen ends up saying a word nobody wrote.
 */
export function setLocale(code: string): boolean {
  if (!(code in CATALOGS)) return false;
  locale.set(code);
  return true;
}

/** The name of a language, in that language. */
export function nativeName(code: string): string {
  return BUNDLED_LOCALES.find((entry) => entry.code === code)?.nativeName ?? code;
}

/** The languages the app can be read in. */
export function availableLocales(): ReadonlyArray<ILocale> {
  return BUNDLED_LOCALES.filter((entry) => entry.code in CATALOGS);
}
