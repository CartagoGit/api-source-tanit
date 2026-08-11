/**
 * El explorador de carpetas.
 *
 * Escribir la ruta a mano es donde más se falla: una errata devuelve «no
 * existe» y no queda pista de dónde estabas. Lo que se comprueba aquí es
 * que navegar no se convierta en otra cosa:
 *
 *   1. **Solo carpetas.** Ni ficheros ni su contenido. Esto es un
 *      servidor HTTP en la máquina de alguien, y un endpoint que
 *      devolviera contenido sería un lector de ficheros arbitrario.
 *   2. **Un directorio ilegible no rompe la lista.** Quien navega por
 *      `/` se cruza con carpetas del sistema sin permiso, y que la lista
 *      entera falle por eso haría el explorador inservible justo donde
 *      más falta hace.
 *   3. **La raíz no tiene padre.** Devolverse a sí misma haría que el
 *      botón de subir pareciera roto.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  breadcrumbs,
  browseDirectory,
  defaultBrowseRoot,
} from "../../projects/ui/server/browse.service";

let raiz = "";

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), "explorar-"));
  await mkdir(join(raiz, "alfa"));
  await mkdir(join(raiz, "beta"));
  await mkdir(join(raiz, "alfa", "dentro"));
  await mkdir(join(raiz, ".oculta"));
  await writeFile(join(raiz, "un-fichero.txt"), "no soy una carpeta");
  await writeFile(join(raiz, "secreto.json"), JSON.stringify({ clave: "no salir" }));
});

afterAll(async () => {
  if (raiz) await rm(raiz, { recursive: true, force: true });
});

describe("lo que se lista", () => {
  test("las carpetas, en orden", async () => {
    const r = await browseDirectory(raiz);
    expect(r.ok).toBe(true);
    expect(r.entries.map((e) => e.name)).toEqual(["alfa", "beta"]);
  });

  /**
   * EL test de seguridad. Ni el fichero ni —mucho menos— lo que hay
   * dentro. Un explorador que devuelve contenido es un lector de
   * ficheros arbitrario con otro nombre.
   */
  test("ni los ficheros ni su contenido", async () => {
    const r = await browseDirectory(raiz);
    const serializado = JSON.stringify(r);

    expect(r.entries.map((e) => e.name)).not.toContain("un-fichero.txt");
    expect(serializado).not.toContain("no soy una carpeta");
    expect(serializado).not.toContain("no salir");
  });

  /**
   * Las ocultas fuera: con ellas, la carpeta personal empieza con
   * treinta entradas de configuración antes de la primera que a alguien
   * le interesa. Quien las necesite puede escribir la ruta.
   */
  test("las ocultas no estorban la lista", async () => {
    const r = await browseDirectory(raiz);
    expect(r.entries.map((e) => e.name)).not.toContain(".oculta");
  });

  test("cada entrada trae su ruta absoluta, que es lo que se elige", async () => {
    const r = await browseDirectory(raiz);
    expect(r.entries[0]?.path).toBe(join(raiz, "alfa"));
  });
});

describe("moverse por el árbol", () => {
  test("se baja a una subcarpeta", async () => {
    const r = await browseDirectory(join(raiz, "alfa"));
    expect(r.entries.map((e) => e.name)).toEqual(["dentro"]);
  });

  test("se sube por el padre", async () => {
    const r = await browseDirectory(join(raiz, "alfa"));
    expect(r.parent).toBe(raiz);
  });

  /** Devolverse a sí misma haría que el botón de subir pareciera roto. */
  test("la raíz del sistema no tiene padre", async () => {
    const r = await browseDirectory("/");
    expect(r.parent).toBeNull();
  });

  test("sin ruta se empieza en la carpeta personal, no en la raíz", async () => {
    const r = await browseDirectory();
    expect(r.path).toBe(defaultBrowseRoot());
  });

  test("una ruta vacía tampoco es un error: aún no se ha elegido nada", async () => {
    const r = await browseDirectory("   ");
    expect(r.ok).toBe(true);
    expect(r.path).toBe(defaultBrowseRoot());
  });
});

describe("lo que no se puede abrir se dice, sin romper nada", () => {
  test("una carpeta que no existe da un motivo, no una excepción", async () => {
    const r = await browseDirectory(join(raiz, "no-existe"));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not a folder");
    expect(r.entries).toEqual([]);
  });

  test("un fichero no es una carpeta, y lo dice", async () => {
    const r = await browseDirectory(join(raiz, "un-fichero.txt"));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not a folder");
  });

  /**
   * Un enlace roto se **marca**, no desaparece: verlo y no poder entrar
   * se entiende; que no salga parece que el explorador falla.
   */
  test("un enlace roto sale marcado como ilegible", async () => {
    const conEnlace = await mkdtemp(join(tmpdir(), "enlace-"));
    try {
      await symlink(join(conEnlace, "no-existe"), join(conEnlace, "colgando"));
      const r = await browseDirectory(conEnlace);
      const colgando = r.entries.find((e) => e.name === "colgando");
      expect(colgando).toBeDefined();
      expect(colgando!.readable).toBe(false);
    } finally {
      await rm(conEnlace, { recursive: true, force: true });
    }
  });
});

describe("las migas de pan", () => {
  test("van de la raíz hasta la carpeta actual", async () => {
    const migas = breadcrumbs("/uno/dos/tres");
    expect(migas.map((m) => m.name)).toEqual(["/", "uno", "dos", "tres"]);
  });

  test("cada miga lleva la ruta a la que salta", () => {
    const migas = breadcrumbs("/uno/dos");
    expect(migas.map((m) => m.path)).toEqual(["/", "/uno", "/uno/dos"]);
  });

  test("la raíz sola es una sola miga", () => {
    expect(breadcrumbs("/").map((m) => m.name)).toEqual(["/"]);
  });
});
