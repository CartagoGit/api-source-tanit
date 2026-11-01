/**
 * Browsing folders.
 *
 * What travels are **directory names**, never file contents. It is
 * not a simplification: an endpoint that returned content would be
 * an arbitrary file reader running on someone's machine, and it
 * does not matter that it only listens on `127.0.0.1` — this same
 * UI already had a CSRF because that reasoning felt safe.
 *
 * It used to be a CLI-only contract (`interfaces/cli/`), because the
 * CLI's web interface was the only thing that browsed folders. The
 * desktop app needs the same thing, through the Application API, so
 * the contract moved to the core: one shape, two faces.
 */

/** A folder in the listing. */
export interface IBrowseEntry {
  /** Plain name, for display. */
  readonly name: string;
  /** Absolute path, which is what's selected. */
  readonly path: string;
  /**
   * Whether it can be entered.
   *
   * A permission-denied folder, or a broken link, shows up flagged
   * instead of disappearing: seeing it and not being able to enter
   * is intelligible; its absence looks like a broken browser.
   */
  readonly readable: boolean;
}

/** The result of listing a folder. */
export interface IBrowseListing {
  readonly ok: boolean;
  /** The folder that was listed, already resolved to absolute. */
  readonly path: string;
  /** The parent, or `null` if this is the root. */
  readonly parent: string | null;
  readonly entries: ReadonlyArray<IBrowseEntry>;
  /**
   * Whether the listing was truncated.
   *
   * Lives apart from the reason because it's a condition, not a
   * message: the UI needs to know it to show a notice, and reading
   * prose to decide that is what breaks when it's translated.
   */
  readonly truncated: boolean;
  /** Why it failed, or why it was truncated. `undefined` on success. */
  readonly reason?: string;
}
