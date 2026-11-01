import { DOCUMENT } from "@angular/common";
import { Injectable, inject } from "@angular/core";

import {
  locale as currentLocale,
  availableLocales,
  nativeName as nativeNameOf,
  setLocale as changeTo,
  translate as word,
} from "./i18n.state";

/**
 * The language, remembered and announced.
 *
 * The words live in {@link ./i18n.state.ts}: the state is a module
 * signal, so the transport can use it without an injection context.
 * This service is the part the screens talk to — it remembers the
 * choice and tells the **document** about it.
 *
 * The document matters more than it looks: `lang` is what the
 * browser uses to pick a hyphenation and a font, and what a screen
 * reader reads the document's language as. A page that says "es" in
 * its content and `lang="en"` in its element is lying twice.
 */
@Injectable({ providedIn: "root" })
export class I18nService {
  private readonly document = inject(DOCUMENT);

  /** The languages the app can be read in. */
  readonly locales = availableLocales();

  /** The language in use. */
  readonly locale = currentLocale;

  constructor() {
    this.setLocale(this.readStoredLocale());
    this.applyToDocument(this.locale());
  }

  /**
   * The word for a key, in the language in use.
   *
   * It is a method and not a field on purpose: a field would be read
   * once, when the component was built, and the label would stay in
   * the language the app happened to start in.
   */
  translate(key: string, values?: Readonly<Record<string, string | number>>): string {
    return word(key, values);
  }

  /**
   * Changes the language and remembers it.
   *
   * The document is updated too, so that the browser and the screen
   * reader know what the page is written in.
   */
  setLocale(locale: string): void {
    if (!changeTo(locale)) return;
    this.storage()?.setItem("tanit.locale", locale);
    this.applyToDocument(locale);
  }

  /** The name of a language, in that language. */
  nativeName(code: string): string {
    return nativeNameOf(code);
  }

  /**
   * The language to start in.
   *
   * The one the person chose last time, and — if they never chose —
   * the one their browser asks for. A browser in Spanish gets the
   * app in Spanish without asking.
   */
  private readStoredLocale(): string {
    const stored = this.storage()?.getItem("tanit.locale");
    if (stored !== null && stored !== undefined && stored !== "") return stored;
    const browser = this.document.defaultView?.navigator?.language ?? "";
    return browser.split("-")[0] ?? "";
  }

  private applyToDocument(locale: string): void {
    const element = this.document.documentElement;
    if (!element) return;
    element.setAttribute("lang", locale);
    const rtl = this.locales.find((entry) => entry.code === locale)?.rtl === true;
    element.setAttribute("dir", rtl ? "rtl" : "ltr");
  }

  private storage(): Storage | undefined {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  }
}
