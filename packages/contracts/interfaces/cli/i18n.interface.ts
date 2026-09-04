/**
 * What the UI needs to speak a language.
 *
 * A catalog is a flat key → text map. Flat and not nested by
 * design: `settings.language.title` as a literal key is findable
 * in a file with Ctrl+F, while a nested object forces three levels
 * of traversal to know whether a key exists — which is why
 * translations stay half-finished without anyone noticing.
 */

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
