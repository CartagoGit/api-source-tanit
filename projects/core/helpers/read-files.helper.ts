/**
 * Leer muchos ficheros sin leerlos de uno en uno.
 *
 * Los dieciocho scanners hacen lo mismo: recogen las rutas que les
 * interesan y luego recorren la lista con `await readFile(f)` dentro del
 * bucle. Eso es una lectura **cada vez**, esperando a que el disco
 * conteste antes de pedir la siguiente, cuando el kernel puede atender
 * varias a la vez sin despeinarse.
 *
 * Medido sobre un proyecto sintético de 1000 ficheros:
 *
 * | Forma | Tiempo |
 * | --- | --: |
 * | Una a una (lo que había) | 131 ms |
 * | Con tope de 16 en vuelo | 14 ms |
 *
 * Nueve veces y media. Dicho lo cual, y para que nadie se lleve una
 * decepción: la lectura es **el 19%** del pipeline en ese proyecto, así
 * que el total baja de ~746 ms a ~630 ms. El resto es parseo, y ahí no
 * hay disco que valga. La medida está en `bench-scan.script.ts` para que
 * la siguiente afirmación sobre rendimiento también salga de un número.
 *
 * Tres cosas que esta función respeta a propósito:
 *
 *   1. **El orden de entrada.** Los scanners construyen la colección
 *      recorriendo ficheros, y si el orden bailara entre ejecuciones la
 *      colección saldría distinta cada vez. Se lee en paralelo pero se
 *      entrega en orden.
 *   2. **La memoria acotada.** Es un generador con ventana deslizante,
 *      no un `Promise.all` sobre la lista entera: como mucho hay `limit`
 *      ficheros en vuelo, no diez mil.
 *   3. **Que un fichero ilegible no tumbe el escaneo.** Se salta, igual
 *      que hacía cada scanner con su `try/catch`.
 */
import { readFile } from "node:fs/promises";
import type { IReadFile } from "../../contracts/interfaces/core/helpers.interface.js";
import { READ_CONCURRENCY } from "../../contracts/constants/core/runtime-limits.constant.js";

/** Un fichero leído. */

async function readOne(path: string): Promise<IReadFile | null> {
  try {
    return { path, text: await readFile(path, "utf8") };
  } catch {
    // Permisos, un enlace roto, un fichero que desaparece a mitad del
    // escaneo. Ninguno es motivo para no leer los otros novecientos.
    return null;
  }
}

/**
 * Lee `paths` en paralelo (con tope) y los entrega **en el orden de
 * entrada**.
 *
 * Los que no se puedan leer no aparecen, sin avisar: es lo que ya hacía
 * cada scanner por su cuenta.
 *
 * ```ts
 * for await (const { path, text } of readFilesInOrder(files)) {
 *   // …
 * }
 * ```
 */
export async function* readFilesInOrder(
  paths: ReadonlyArray<string>,
  limit: number = READ_CONCURRENCY,
): AsyncGenerator<IReadFile> {
  // Un tope de 0 o negativo dejaría la ventana vacía y el bucle no
  // arrancaría nunca: se trata como "de una en una".
  const width = Math.max(1, Math.trunc(limit));

  /** Lecturas en vuelo, en orden de entrada. */
  const window: Array<Promise<IReadFile | null>> = [];
  let next = 0;

  while (next < paths.length && window.length < width) {
    window.push(readOne(paths[next]!));
    next++;
  }

  while (window.length > 0) {
    // `shift` mantiene el orden: se espera siempre a la más antigua,
    // aunque otra de la ventana haya terminado antes.
    const head = await window.shift()!;
    if (next < paths.length) {
      window.push(readOne(paths[next]!));
      next++;
    }
    if (head) yield head;
  }
}

/**
 * Lo mismo, pero en un array.
 *
 * Para quien necesite la lista entera de todas formas (un `Map` de
 * módulo → contenido, por ejemplo). Si solo se va a recorrer una vez,
 * usa el generador: gasta memoria acotada en vez de toda.
 */
export async function readAllFiles(
  paths: ReadonlyArray<string>,
  limit: number = READ_CONCURRENCY,
): Promise<IReadFile[]> {
  const out: IReadFile[] = [];
  for await (const file of readFilesInOrder(paths, limit)) out.push(file);
  return out;
}
