/**
 * Theme modes and the variables each one defines.
 *
 * Not a single color hard-coded in any rule: **everything** points to
 * a variable, and switching themes is just changing those variables.
 * That is what makes adding a theme a twelve-line change instead of
 * duplicating the entire stylesheet — and what keeps a new theme from
 * silently forgetting half the elements.
 *
 * ## Why CSS variables and not classes
 *
 * With classes (`.dark .button { … }`), every element needs its
 * rule repeated per theme — a new element looks right in the theme
 * it was written in and broken in the others. With variables, a new
 * element inherits the theme without anyone having to remember it.
 *
 * ## The three modes, and why "system" is the default
 *
 * Somebody whose OS is in dark mode set it that way for a reason —
 * it's night, or bright light hurts — and opening an app in
 * brilliant white is exactly what they configured against.
 * `prefers-color-scheme` already says so; ignoring it would be
 * asking a question that's already been answered.
 */

/** The modes the user can pick in settings. */
export const THEME_MODES = ["system", "light", "dark"] as const;

/** A valid theme mode. */
export type ThemeMode = (typeof THEME_MODES)[number];

/** The default: whatever the user picked in their system. */
export const DEFAULT_THEME: ThemeMode = "system";

/**
 * The variable names, in a single place.
 *
 * Declared here (not only in the CSS) so a test can verify that
 * **both themes define the same variables**. A theme that's missing
 * a variable does not error — it inherits from the other and ends
 * up broken in one
 * sitio concreto, que es de los fallos más difíciles de encontrar
 * mirando código.
 */
export const THEME_VARIABLES = [
  "--fondo",
  "--fondo-elevado",
  "--borde",
  "--texto",
  "--texto-suave",
  "--acento",
  "--acento-texto",
  "--exito",
  "--aviso",
  "--error",
  "--sombra",
  "--foco",
] as const;
