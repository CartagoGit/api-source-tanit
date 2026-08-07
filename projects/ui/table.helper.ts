/**
 * Tablas de terminal que no se descuadran.
 *
 * Dos cosas que parecen detalle y son las que rompen una tabla:
 *
 *   1. **El color ocupa cero.** `[32mGET[0m` son tres
 *      caracteres visibles y doce reales. Alinear con `padEnd` normal
 *      descuadra cada celda coloreada, y el fallo solo se ve en la
 *      terminal de otra persona.
 *   2. **La terminal no siempre mide 80.** Una tabla más ancha que la
 *      ventana la parte el propio emulador por donde le apetece, y deja
 *      de ser una tabla. Las columnas se reparten el ancho real.
 *
 * Las columnas se dimensionan por su contenido y luego se recorta la más
 * ancha —no todas por igual— hasta que quepa. Recortar por igual acaba
 * dejando el método HTTP en `GE`, que no dice nada, mientras la URI
 * sigue sobrando.
 */
import { padEnd, padStart, terminalWidth, truncate, visibleWidth } from "./ansi.helper.js";

export interface IColumn {
  readonly header: string;
  /** Alineación del contenido. Los números se leen mejor a la derecha. */
  readonly align?: "left" | "right";
  /**
   * Ancho mínimo que conserva al recortar.
   *
   * `GET` con dos caracteres no es un método; con seis, cualquiera lo es.
   */
  readonly min?: number;
}

/** Separador entre columnas. Dos espacios: bastan y no roban ancho. */
const GAP = "  ";

function widthsFor(
  columns: ReadonlyArray<IColumn>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
  available: number,
): number[] {
  const widths = columns.map((column, i) =>
    Math.max(
      visibleWidth(column.header),
      ...rows.map((row) => visibleWidth(row[i] ?? "")),
    ),
  );

  const gaps = GAP.length * (columns.length - 1);
  let total = widths.reduce((sum, w) => sum + w, 0) + gaps;

  // Se recorta siempre la columna más ancha que aún pueda encoger. Así
  // la que sobra es la que paga, y las cortas se quedan legibles.
  while (total > available) {
    let widest = -1;
    let widestWidth = 0;
    for (let i = 0; i < widths.length; i++) {
      const min = columns[i]?.min ?? 4;
      const w = widths[i] ?? 0;
      if (w > min && w > widestWidth) {
        widest = i;
        widestWidth = w;
      }
    }
    // Ninguna puede encoger más: la tabla se sale, y es preferible eso a
    // dejar columnas ilegibles.
    if (widest === -1) break;
    widths[widest] = widestWidth - 1;
    total--;
  }
  return widths;
}

/**
 * Dibuja la tabla.
 *
 * `width` se puede pasar para las pruebas; por defecto, el de la
 * terminal.
 */
export function renderTable(
  columns: ReadonlyArray<IColumn>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
  width: number = terminalWidth(),
): string[] {
  if (columns.length === 0) return [];
  const widths = widthsFor(columns, rows, width);

  const line = (cells: ReadonlyArray<string>): string =>
    cells
      .map((cell, i) => {
        const w = widths[i] ?? 0;
        const clipped = truncate(cell, w);
        return columns[i]?.align === "right" ? padStart(clipped, w) : padEnd(clipped, w);
      })
      .join(GAP)
      // Sin esto, cada fila arrastra los espacios de relleno de la última
      // columna y un `diff` de la salida sale lleno de ruido invisible.
      .trimEnd();

  return [
    line(columns.map((c) => c.header)),
    widths.map((w) => "─".repeat(w)).join(GAP).trimEnd(),
    ...rows.map(line),
  ];
}
