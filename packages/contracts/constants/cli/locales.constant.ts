/**
 * Languages the UI ships with, and how one is chosen.
 *
 * Fifteen, by number of speakers. Not a closed list: more can be
 * added by dropping a file in the user's languages folder, and that
 * is intentional — adding a language must not require code changes or
 * a recompile.
 *
 * ## Why the code, not the name
 *
 * The identifier is the BCP 47 code (`es`, `pt-BR`, `zh-Hans`),
 * because that is what the browser (`navigator.language`) and the
 * system (`LANG`) report. Storing "Spanish" would force a translation
 * back at every startup, which is where accents and case go wrong.
 *
 * ## Name in its own language
 *
 * `nativeName` is in the language it names — "Français", not "French"
 * — because a person looking for their language in a list does not
 * know how to say theirs in the language they are reading. Every
 * language picker in the world does it this way for the same reason.
 */

/** A language the UI speaks. */
export interface ILocale {
  /** BCP 47 code. This is what the browser and the system report. */
  readonly code: string;
  /** The language's name **in its own language**. */
  readonly nativeName: string;
  /** Right-to-left writing. Changes the document's `dir` attribute. */
  readonly rtl?: boolean;
}

/**
 * The language we fall back to when nothing better matches.
 *
 * English — not Spanish — even though the repository's internal prose
 * was Spanish: what the end user of the tool sees is product surface,
 * and English was already the decision there (`r00003`).
 */
export const FALLBACK_LOCALE = "en";

/**
 * Los quince, en orden de hablantes.
 *
 * El orden importa poco funcionalmente, pero uno estable hace que
 * añadir un idioma sea una línea de diff en vez de un bloque
 * reordenado.
 */
export const BUNDLED_LOCALES: ReadonlyArray<ILocale> = [
  { code: "en", nativeName: "English" },
  { code: "zh-Hans", nativeName: "简体中文" },
  { code: "hi", nativeName: "हिन्दी" },
  { code: "es", nativeName: "Español" },
  { code: "ar", nativeName: "العربية", rtl: true },
  { code: "fr", nativeName: "Français" },
  { code: "bn", nativeName: "বাংলা" },
  { code: "pt", nativeName: "Português" },
  { code: "ru", nativeName: "Русский" },
  { code: "ur", nativeName: "اردو", rtl: true },
  { code: "id", nativeName: "Bahasa Indonesia" },
  { code: "de", nativeName: "Deutsch" },
  { code: "ja", nativeName: "日本語" },
  { code: "tr", nativeName: "Türkçe" },
  { code: "ko", nativeName: "한국어" },
];
