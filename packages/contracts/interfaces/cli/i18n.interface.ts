/**
 * What the UI needs to speak a language.
 *
 * A catalog is a flat key → text map. Flat and not nested by
 * design: `settings.language.title` as a literal key is findable
 * in a file with Ctrl+F, while a nested object forces three levels
 * of traversal to know whether a key exists — which is why
 * translations stay half-finished without anyone noticing.
 */

/**
 * Completion status declared by each locale in its
 * `_meta._completeness`. x00037 S1 introduced the field; x00040 S1
 * uses it to filter the visible catalog.
 *
 *   - `reference`: language that is the source of fallback (English
 *     today; everything missing in any other locale falls back here).
 *   - `complete`:  translated, ready to show.
 *   - `experimental`: file shipped as a placeholder; the UI selector
 *     hides it (a label that lies about its content is worse than
 *     no label at all).
 *   - `unknown`:    no `_meta` or malformed. Treated as visible — the
 *     gate `lint:i18n-completeness` catches unmarked placeholders,
 *     so a future unannotated locale showing up here is an honest
 *     "not verified yet", not a bug to hide.
 */
export type Completitud = "reference" | "complete" | "experimental" | "unknown";

/** A translations catalog: key → text in that language. */
export type ITranslations = Readonly<Record<string, string>>;

/** A loaded, ready-to-use language. */
export interface ILoadedLocale {
  readonly code: string;
  /** How the language is called in its own language, for the picker. */
  readonly nativeName: string;
  /** Right-to-left writing. */
  readonly rtl: boolean;
  readonly translations: ITranslations;
  /**
   * Where it came from.
   *
   * `bundled` ships inside the program; `external` was dropped in
   * the languages folder by someone. The distinction is not
   * informational: an external locale with the same code as a
   * bundled one **wins**, and whoever dropped it there has to be
   * able to confirm their file is the one in effect.
   */
  readonly origin: "bundled" | "external";
}

/** The full catalog, resolved. */
export interface II18nCatalog {
  /** The available languages, for the picker. */
  readonly locales: ReadonlyArray<ILoadedLocale>;
  /**
   * External files that **could not** be loaded, with the reason.
   *
   * They live here, not as a `throw`: a broken locale someone
   * dropped in their folder must not prevent the UI from starting.
   * But it must not disappear silently either, because then the
   * author has no way to know why their language is missing from
   * the list.
   */
  readonly rejected: ReadonlyArray<{ readonly file: string; readonly reason: string }>;
}
