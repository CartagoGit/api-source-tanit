/**
 * Escribir entero o no escribir.
 *
 * `writeFile` trunca antes de escribir, así que entre los dos momentos
 * el fichero está a medias. El caso que importa es `watch`: reescribe la
 * colección en cada cambio del proyecto mientras Postman la tiene
 * importada, así que cada guardado era una ventana para leer un JSON
 * truncado — y un JSON truncado no es una colección incompleta, es un
 * fichero que Postman no abre.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  writeFileAtomic,
  writeJsonAtomic,
} from "../../projects/core/helpers/atomic-write.helper";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "atomic-"));
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  test("escribe el contenido", async () => {
    const destino = join(dir, "a.txt");
    await writeFileAtomic(destino, "hola");
    expect(await readFile(destino, "utf8")).toBe("hola");
  });

  test("sustituye lo que hubiera", async () => {
    const destino = join(dir, "a.txt");
    await writeFile(destino, "viejo");
    await writeFileAtomic(destino, "nuevo");
    expect(await readFile(destino, "utf8")).toBe("nuevo");
  });

  test("crea el directorio si no existe", async () => {
    const destino = join(dir, "sub", "otro", "a.txt");
    await writeFileAtomic(destino, "hola");
    expect(await readFile(destino, "utf8")).toBe("hola");
  });

  /**
   * El temporal tiene que nacer **al lado** del destino. En `/tmp` el
   * `rename` cruzaría sistemas de ficheros, que no es atómico: el
   * sistema devuelve `EXDEV` y toca copiar, que es justo lo que se
   * quería evitar.
   */
  test("no deja temporales al terminar", async () => {
    await writeFileAtomic(join(dir, "a.txt"), "hola");
    expect(await readdir(dir)).toEqual(["a.txt"]);
  });

  test("tampoco los deja cuando falla", async () => {
    // Un destino que es un directorio: el `rename` no puede sustituirlo.
    const destino = join(dir, "soy-un-dir");
    await writeFileAtomic(join(destino, "dentro.txt"), "x");
    await expect(writeFileAtomic(destino, "hola")).rejects.toThrow();
    // Queda el directorio y lo que tenía dentro; ningún `.tmp` suelto.
    const sobrantes = (await readdir(dir)).filter((n) => n.endsWith(".tmp"));
    expect(sobrantes).toEqual([]);
  });

  /**
   * EL test. Con `writeFile` directo, un fallo a mitad deja el fichero
   * anterior destrozado; aquí tiene que quedarse intacto.
   */
  test("un fallo deja el fichero anterior exactamente como estaba", async () => {
    const destino = join(dir, "coleccion.json");
    const bueno = JSON.stringify({ item: [1, 2, 3] }, null, 2);
    await writeFile(destino, bueno);

    // Un objeto con ciclo: `JSON.stringify` lanza antes de tocar disco.
    const ciclo: Record<string, unknown> = {};
    ciclo["yo"] = ciclo;
    await expect(writeJsonAtomic(destino, ciclo)).rejects.toThrow();

    expect(await readFile(destino, "utf8")).toBe(bueno);
    expect(() => JSON.parse(bueno) as unknown).not.toThrow();
  });

  test("escrituras concurrentes sobre la misma ruta no se pisan el temporal", async () => {
    const destino = join(dir, "a.txt");
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => writeFileAtomic(destino, `valor-${i}`)),
    );
    // Gana una, pero el fichero es una de las doce enteras, no un trozo
    // de una pegado a un trozo de otra.
    expect(await readFile(destino, "utf8")).toMatch(/^valor-\d+$/);
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("writeJsonAtomic", () => {
  test("escribe JSON indentado y con salto final", async () => {
    const destino = join(dir, "a.json");
    await writeJsonAtomic(destino, { a: 1 });
    const raw = await readFile(destino, "utf8");
    expect(raw).toBe('{\n  "a": 1\n}\n');
  });

  test("lo que escribe se puede volver a leer", async () => {
    const destino = join(dir, "a.json");
    const valor = { item: [{ name: "x" }], info: { schema: "v2.1.0" } };
    await writeJsonAtomic(destino, valor);
    expect(JSON.parse(await readFile(destino, "utf8")) as unknown).toEqual(valor);
  });

  /**
   * Serializar antes de abrir el fichero no es un detalle de estilo: si
   * se serializara mientras se escribe, un objeto con un ciclo dejaría
   * el fichero a medias sin que el proceso llegara a morirse.
   */
  test("un objeto que no se puede serializar no llega a crear fichero", async () => {
    const destino = join(dir, "nunca.json");
    const ciclo: Record<string, unknown> = {};
    ciclo["yo"] = ciclo;
    await expect(writeJsonAtomic(destino, ciclo)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
