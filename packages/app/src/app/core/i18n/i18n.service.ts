import { DOCUMENT } from "@angular/common";
import { Injectable, inject, signal } from "@angular/core";

import {
  BUNDLED_LOCALES,
  FALLBACK_LOCALE,
} from "../../../../../contracts/constants/cli/locales.constant";

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
 * missing a key, if the app asks for a key no locale has, or if a
 * catalog carries a key nobody asks for.
 *
 * The **list** of languages is the product's, not the app's: the
 * same `BUNDLED_LOCALES` the interface inside the binary uses, with
 * each language named in its own language. The app ships the ones it
 * has a catalog for; adding a language is dropping a file in
 * `locales/` and re-running the gate.
 */
type Catalog = Readonly<Record<string, string>>;

/** The catalogs the app ships, by language code. */
const CATALOGS: Readonly<Record<string, Catalog>> = { en, es, fr };

@Injectable({ providedIn: "root" })
export class I18nService {
  private readonly document = inject(DOCUMENT);

  /** The languages the app can be read in. */
  readonly locales = BUNDLED_LOCALES.filter((locale) => locale.code in CATALOGS);

  /** The language in use. */
  readonly locale = signal<string>(this.readLocale());

  constructor() {
    this.applyToDocument(this.locale());
  }

  /**
   * The word for a key, in the language in use.
   *
   * It falls back to English, and then to the key itself. Returning
   * the key is deliberate: a missing translation then reads as
   * `endpoints.loading` on the screen — obvious — instead of a dash,
   * which looks like a value that happens to be empty.
   */
  translate(key: string): string {
    const catalog = CATALOGS[this.locale()] ?? CATALOGS[FALLBACK_LOCALE] ?? {};
    return catalog[key] ?? CATALOGS[FALLBACK_LOCALE]?.[key] ?? key;
  }

  /**
   * Changes the language and remembers it.
   *
   * The document is updated too: `lang` is what the browser uses to
   * pick a hyphenation and a font, and what a screen reader reads
   * the document's language as. A page that says "es" in its content
   * and `lang="en"` in its element is lying twice.
   */
  setLocale(locale: string): void {
    if (!(locale in CATALOGS)) return;
    this.locale.set(locale);
    this.storage()?.setItem("tanit.locale", locale);
    this.applyToDocument(locale);
  }

  /** The name of a language, in that language. */
  nativeName(code: string): string {
    return BUNDLED_LOCALES.find((locale) => locale.code === code)?.nativeName ?? code;
  }

  private readLocale(): string {
    const stored = this.storage()?.getItem("tanit.locale");
    if (stored !== null && stored !== undefined && stored in CATALOGS) return stored;
    const browser = this.document.defaultView?.navigator?.language ?? "";
    const base = browser.split("-")[0] ?? "";
    return base in CATALOGS ? base : FALLBACK_LOCALE;
  }

  private applyToDocument(locale: string): void {
    const element = this.document.documentElement;
    if (!element) return;
    element.setAttribute("lang", locale);
    const rtl = BUNDLED_LOCALES.find((entry) => entry.code === locale)?.rtl === true;
    element.setAttribute("dir", rtl ? "rtl" : "ltr");
  }

  private storage(): Storage | undefined {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  }
}
