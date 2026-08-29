/**
 * Escribir un fichero entero, o no escribirlo.
 *
 * `writeFile` sobre una ruta que ya existe **trunca primero y escribe
 * después**. Entre esos dos momentos el fichero está a medias, y si el
 * proceso muere ahí —Ctrl-C, OOM, la batería— lo que queda no es una
 * colección incompleta: es un JSON truncado, que Postman no abre.
 *
 * El caso serio es `watch`. Reescribe la colección en cada cambio del
 * proyecto, y el flujo que documenta el README es tenerla importada en
 * Postman mientras se programa. Cada guardado era una ventana para leer
 * un JSON a medio escribir, y el producto entero de esta herramienta es
 * ese fichero.
 *
 * La solución es vieja y conocida: escribir en un temporal y renombrar.
 * `rename` dentro del mismo sistema de ficheros es atómico — quien lea
 * la ruta ve el contenido de antes o el de después, nunca la mitad.
 *
 * Dos detalles que no son opcionales:
 *
 *   1. **El temporal va en el directorio de destino**, no en `/tmp`.
 *      Un `rename` entre sistemas de ficheros distintos no existe: el
 *      sistema devuelve `EXDEV` y hay que copiar, que es justo lo que
 *      se quería evitar. Y `/tmp` es otro sistema de ficheros más veces
 *      de las que parece.
 *   2. **El temporal se borra si algo falla**, para no dejar basura al
 *      lado de la colección con un nombre que nadie reconoce.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Sufijo del temporal.
 *
 * Lleva el pid y un contador para que dos escrituras a la vez sobre la
 * misma ruta no se pisen el temporal la una a la otra. No es un caso
 * que se haya visto, pero el coste de evitarlo es una plantilla.
 */
let secuencia = 0;
function rutaTemporal(destino: string): string {
  secuencia += 1;
  const proceso = typeof process === "undefined" ? 0 : process.pid;
  return join(dirname(destino), `.${proceso}-${secuencia}.tmp`);
}

/**
 * Escribe `contenido` en `destino` de forma atómica.
 *
 * Crea el directorio si hace falta. Si algo falla, `destino` se queda
 * exactamente como estaba y no queda ningún temporal por el medio.
 */
export async function writeFileAtomic(
  destino: string,
  contenido: string,
): Promise<void> {
  const dir = dirname(destino);
  await mkdir(dir, { recursive: true });

  const temporal = rutaTemporal(destino);
  try {
    await writeFile(temporal, contenido, "utf8");
    await rename(temporal, destino);
  } catch (error) {
    // El temporal solo estorba. Si tampoco se puede borrar, el error que
    // se propaga es el de la escritura, que es el que explica lo que
    // pasó — no el del borrado, que es una consecuencia.
    await rm(temporal, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Lo mismo, para JSON.
 *
 * Serializa **antes** de tocar el disco: si el objeto tiene un ciclo o
 * un `BigInt`, `JSON.stringify` lanza y no se ha abierto ningún fichero.
 * Serializar mientras se escribe es como se acaba con un fichero a
 * medias sin que el proceso llegue a morirse.
 */
export async function writeJsonAtomic(
  destino: string,
  valor: unknown,
  espacios = 2,
): Promise<void> {
  const json = `${JSON.stringify(valor, null, espacios)}\n`;
  await writeFileAtomic(destino, json);
}
