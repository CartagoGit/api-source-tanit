/**
 * What the UI remembers between openings.
 *
 * Everything is optional except the version, and that asymmetry is
 * deliberate: a missing setting has a reasonable default, so a
 * half-written file still works. The only thing that cannot be
 * missing is knowing **what shape that file has**, because reading
 * it depends on it.
 *
 * ## Why there's a version
 *
 * The file is written by one version of the program and read by
 * another, maybe months later. Without a number, a field whose
 * meaning changes will be misread silently — and the result is a
 * UI that starts up with settings nobody chose.
 */

import type { ThemeMode } from "../../constants/cli/theme.constant.js";

/** Format version. Bumps when a field changes meaning. */
export const SETTINGS_VERSION = 1;

/**
 * What the program starts with when nothing is saved.
 *
 * Only the version: anything else missing means "whatever the
 * system decided" — the browser's language, the desktop's theme —
 * which is not the same as a concrete value. Hard-coding
 * `locale: "en"` here would make a Japanese user see English
 * without ever having asked for it.
 */
/** What is persisted from one session to the next. */
export interface ISettings {
  /** Version this was written under. */
  readonly version: number;
  /**
   * Code of the language the user picked manually.
   *
   * `undefined` means "the system one", which is not the same as a
   * concrete language: if someone switches their OS language,
   * they want the UI to follow.
   */
  readonly locale?: string;
  /** `system`, `light`, or `dark`. */
  readonly theme?: ThemeMode;
  /** Last project looked at, so the path doesn't have to be retyped. */
  readonly lastProjectRoot?: string;
  /** Last output folder, if a different one was picked. */
  readonly lastOutputDir?: string;
  /** Formats checked off last time. */
  readonly lastFormats?: ReadonlyArray<string>;
  /**
   * Framework forced last time.
   *
   * `undefined` is "detect automatically". Remembering a forced
   * framework matters: whoever had to force it once will keep
   * having to force it on that project.
   */
  readonly lastFramework?: string;
}

export const DEFAULT_SETTINGS: ISettings = { version: SETTINGS_VERSION };

/** Returned when reading settings from disk. */
export interface ISettingsRead {
  readonly settings: ISettings;
  /**
   * Why the saved settings could not be used, if any were found.
   *
   * `null` on success **or** when no file was found — which is
   * normal on first run and not a problem. When there is a reason,
   * the UI falls back to defaults and surfaces it: settings that
   * disappear silently look like a program bug.
   */
  readonly problem: string | null;
}
