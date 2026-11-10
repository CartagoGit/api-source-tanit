/**
 * Color y ancho de terminal, con la degradación bien hecha.
 *
 * Es la parte que casi siempre se ship rota: se escriben secuencias ANSI
 * a pelo y la salida se ve como `[32m✔[0m` en cuanto alguien
 * hace `apisrc list > salida.txt`, la mete en un pipe, o la lee un
 * runner de CI. El color es una ayuda para quien mira; cuando nadie
 * mira, estorba.
 *
 * Se apaga si se da **cualquiera** de estas:
 *
 *   - `NO_COLOR` está definida. Es el convenio de facto
 *     (https://no-color.org) y no admite discusión: si está, no hay
 *     color, valga lo que valga.
 *   - `TERM=dumb`. Lo ponen editores y algunos entornos de CI.
 *   - La salida **no es un terminal**. Un pipe o un fichero no dibuja.
 *
 * Y se enciende a la fuerza con `FORCE_COLOR`, que es lo que usan los
 * runners que sí saben interpretar ANSI aunque no sean un TTY.
 */
import {
  ANSI_CODES,
  DEFAULT_TERMINAL_WIDTH,
} from "../contracts/constants/cli/terminal.constant.js";
import type { IPainter } from "../contracts/interfaces/cli/ui.interface.js";



/**
 * Si se debe pintar con color.
 *
 * Recibe el entorno y si la salida es un terminal, en vez de leerlos por
 * su cuenta: así se puede probar sin manosear `process.env` ni fingir un
 * TTY.
 */
export function shouldUseColor(
  env: Record<string, string | undefined>,
  isTty: boolean,
): boolean {
  if (env["NO_COLOR"] !== undefined) return false;
  if (env["FORCE_COLOR"] !== undefined && env["FORCE_COLOR"] !== "0") return true;
  if (env["TERM"] === "dumb") return false;
  return isTty;
}

export function createPainter(enabled: boolean): IPainter {
  return {
    enabled,
    paint(text, color) {
      return enabled ? `${ANSI_CODES[color]}${text}${ANSI_CODES.reset}` : text;
    },
    style(text, ...colors) {
      if (!enabled || colors.length === 0) return text;
      return `${colors.map((c) => ANSI_CODES[c]).join("")}${text}${ANSI_CODES.reset}`;
    },
  };
}

/**
 * El pintor que corresponde a este proceso.
 *
 * `stdout.isTTY` es `undefined` cuando la salida está redirigida, y eso
 * cuenta como "no es un terminal".
 */
export function defaultPainter(): IPainter {
  const stdout = process.stdout as { isTTY?: boolean };
  return createPainter(shouldUseColor(process.env, stdout.isTTY === true));
}

/**
 * Ancho visible de un texto, ignorando las secuencias ANSI.
 *
 * Sin esto, una celda coloreada cuenta los ~9 caracteres invisibles del
 * código de escape y la tabla sale descuadrada — el fallo clásico de
 * alinear texto con color.
 */
export function visibleWidth(text: string): number {
  // eslint-disable-next-line no-control-regex -- es justo lo que hay que quitar
  return text.replace(/\[[0-9;]*m/g, "").length;
}

/** Recorta a `max` caracteres visibles, con `…` si sobra. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (visibleWidth(text) <= max) return text;
  // Con color de por medio no se puede cortar a ciegas: se quita primero.
  const plain = text.replace(/\[[0-9;]*m/g, "");
  return max === 1 ? "…" : `${plain.slice(0, max - 1)}…`;
}

/** Rellena a la derecha hasta `width` caracteres visibles. */
export function padEnd(text: string, width: number): string {
  const missing = width - visibleWidth(text);
  return missing > 0 ? text + " ".repeat(missing) : text;
}

/** Rellena a la izquierda hasta `width` caracteres visibles. */
export function padStart(text: string, width: number): string {
  const missing = width - visibleWidth(text);
  return missing > 0 ? " ".repeat(missing) + text : text;
}

/** Ancho útil de la terminal, acotado para que una tabla no se dispare. */
export function terminalWidth(): number {
  const stdout = process.stdout as { columns?: number };
  const columns = stdout.columns;
  if (typeof columns !== "number" || !Number.isFinite(columns) || columns < 20) {
    return DEFAULT_TERMINAL_WIDTH;
  }
  return Math.min(columns, 160);
}
