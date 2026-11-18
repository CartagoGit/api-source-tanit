/**
 * Fixed values for terminal output.
 *
 * The palette lives here because `ColorName` derives from it: the type
 * of valid colors **is** the list of codes — splitting them would
 * force two lists that drift apart on the first edit. With the type in
 * contracts, the constant has to live next to it.
 */

/**
 * The ANSI codes actually used. Not one extra: what is not used is
 * not declared.
 */
export const ANSI_CODES = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
} as const;

/** Default width when the terminal does not report one. */
export const DEFAULT_TERMINAL_WIDTH = 80;

/**
 * Default port for the web UI.
 *
 * Deliberately unmemorable, and the server picks another if busy:
 * failing on a busy port is the worst possible first impression.
 */
export const DEFAULT_UI_PORT = 4771;
