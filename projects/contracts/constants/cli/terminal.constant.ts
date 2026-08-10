/**
 * Los valores fijos de la salida por terminal.
 *
 * La paleta vive aquí porque `ColorName` se deriva de ella: el tipo de
 * los colores válidos **es** la lista de códigos, así que separarlos
 * obligaría a mantener dos listas que se separan a la primera. Y con el
 * tipo en contratos, la constante tiene que estar al lado.
 */

/**
 * Los códigos ANSI que se usan. Ni uno más: lo que no se usa, no se
 * declara.
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

/** Ancho por defecto cuando la terminal no dice el suyo. */
export const DEFAULT_TERMINAL_WIDTH = 80;

/**
 * Puerto por defecto de la interfaz web.
 *
 * Poco transitado a propósito, y el servidor busca otro si está ocupado:
 * fallar por un puerto ocupado es la peor primera impresión posible.
 */
export const DEFAULT_UI_PORT = 4771;
