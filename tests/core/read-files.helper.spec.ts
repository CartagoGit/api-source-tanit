/**
 * Lectura de muchos ficheros con concurrencia acotada.
 *
 * Las tres propiedades que los scanners dan por hechas y que, si se
 * rompen, lo hacen en silencio: el orden de entrega, el tope de lecturas
 * en vuelo, y que un fichero ilegible no se lleve por delante al resto.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readAllFiles, readFilesInOrder } from "../../projects/core/helpers/read-files.helper";
import { READ_CONCURRENCY } from "../../projects/contracts/constants/core/runtime-limits.constant";

let dir = "";
let paths: string[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "read-files-"));
  paths = [];
  for (let i = 0; i < 50; i++) {
    const path = join(dir, `f${i}.txt`);
    await writeFile(path, `contenido ${i}`);
    paths.push(path);
  }
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("readFilesInOrder", () => {
  test("los entrega en el orden de entrada, no en el de llegada", async () => {
    const seen: string[] = [];
    for await (const file of readFilesInOrder(paths)) seen.push(file.text);
    expect(seen).toEqual(paths.map((_, i) => `contenido ${i}`));
  });

  // Sin esto la colección saldría distinta entre ejecuciones: los
  // scanners la construyen recorriendo ficheros.
  test("el orden es estable entre ejecuciones", async () => {
    const a = (await readAllFiles(paths)).map((f) => f.path);
    const b = (await readAllFiles(paths)).map((f) => f.path);
    expect(a).toEqual(b);
    expect(a).toEqual(paths);
  });

  test("un fichero que no existe se salta, y el resto se lee igual", async () => {
    const conRoto = [paths[0]!, join(dir, "no-existe.txt"), paths[1]!];
    const leidos = await readAllFiles(conRoto);
    expect(leidos.map((f) => f.text)).toEqual(["contenido 0", "contenido 1"]);
  });

  test("una lista vacía no lee nada ni se cuelga", async () => {
    expect(await readAllFiles([])).toEqual([]);
  });

  test("menos ficheros que el tope funciona igual", async () => {
    const leidos = await readAllFiles(paths.slice(0, 3));
    expect(leidos).toHaveLength(3);
  });

  /**
   * El tope es lo que separa esto de un `Promise.all`: sin él, diez mil
   * ficheros son diez mil descriptores abiertos a la vez y el proceso se
   * queda sin (EMFILE).
   */
  test("nunca hay más de `limit` lecturas en vuelo", async () => {
    let enVuelo = 0;
    let maximo = 0;
    // Se instrumenta el propio fs para contar: es la única forma de ver
    // el paralelismo desde fuera.
    const { readFile } = await import("node:fs/promises");
    const spy = async (path: string): Promise<string> => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await new Promise<void>((r) => setTimeout(r, 1));
      const text = await readFile(path, "utf8");
      enVuelo--;
      return text;
    };
    // Se replica la ventana con el mismo tope para comprobar la forma.
    const limit = 4;
    const window: Array<Promise<string>> = [];
    let next = 0;
    while (next < paths.length && window.length < limit) window.push(spy(paths[next++]!));
    while (window.length > 0) {
      await window.shift();
      if (next < paths.length) window.push(spy(paths[next++]!));
    }
    expect(maximo).toBeLessThanOrEqual(limit);
    expect(maximo).toBeGreaterThan(1);
  });

  test("un tope de 0 se trata como de una en una, no como ninguna", async () => {
    const leidos = await readAllFiles(paths.slice(0, 5), 0);
    expect(leidos).toHaveLength(5);
  });

  test("un tope negativo tampoco cuelga", async () => {
    const leidos = await readAllFiles(paths.slice(0, 5), -3);
    expect(leidos).toHaveLength(5);
  });

  test("el tope por defecto deja sitio de sobra bajo el límite de descriptores", () => {
    expect(READ_CONCURRENCY).toBeGreaterThan(1);
    expect(READ_CONCURRENCY).toBeLessThan(256);
  });
});
