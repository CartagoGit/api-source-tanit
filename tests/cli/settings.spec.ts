/**
 * Los ajustes que sobreviven al cierre.
 *
 * Lo que se comprueba no es que se guarden —eso es una línea— sino las
 * cuatro formas en que unos ajustes persistentes se estropean:
 *
 *   1. **Que no haya fichero** la primera vez, y eso no sea un error.
 *   2. **Que el fichero esté roto** y la interfaz siga abriendo.
 *   3. **Que alguien lo edite a mano** y meta un valor imposible: es
 *      texto, en su carpeta, y lo va a editar.
 *   4. **Que lo escribiera una versión posterior**, que es cuando
 *      adivinar el significado de un campo corrompe los ajustes de
 *      alguien.
 */
import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
} from "../../packages/contracts/interfaces/cli/settings.interface";
import {
  patchSettings,
  readSettings,
  settingsPath,
  writeSettings,
} from "../../packages/ui/settings/settings.service";

/** Un fichero de ajustes en un temporal, distinto por test. */
async function conFichero<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ajustes-"));
  try {
    return await fn(join(dir, "settings.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("dónde vive el fichero", () => {
  test("cuelga de la carpeta de configuración, no del paquete", () => {
    expect(settingsPath("/cfg/expostman")).toBe("/cfg/expostman/settings.json");
  });
});

describe("guardar y recuperar", () => {
  test("lo guardado vuelve al reabrir", async () => {
    await conFichero(async (path) => {
      await writeSettings(
        { version: SETTINGS_VERSION, locale: "es", theme: "dark" },
        path,
      );
      const { settings } = await readSettings(path);
      expect(settings.locale).toBe("es");
      expect(settings.theme).toBe("dark");
    });
  });

  test("guardar crea la carpeta si no está", async () => {
    await conFichero(async (path) => {
      const anidado = join(path, "..", "sub", "carpeta", "settings.json");
      await writeSettings({ version: SETTINGS_VERSION, locale: "fr" }, anidado);
      expect((await readSettings(anidado)).settings.locale).toBe("fr");
    });
  });

  /**
   * Cambiar un ajuste no puede borrar los otros. Guardar el objeto
   * entero desde el navegador haría que dos pestañas se pisaran lo que
   * la otra acaba de cambiar.
   */
  test("cambiar uno conserva el resto", async () => {
    await conFichero(async (path) => {
      await writeSettings(
        { version: SETTINGS_VERSION, locale: "es", theme: "dark", lastProjectRoot: "/x" },
        path,
      );
      const tras = await patchSettings({ theme: "light" }, path);

      expect(tras.theme).toBe("light");
      expect(tras.locale).toBe("es");
      expect(tras.lastProjectRoot).toBe("/x");
    });
  });

  test("la versión se escribe siempre, aunque no se pase", async () => {
    await conFichero(async (path) => {
      await writeSettings({ version: 0, locale: "de" }, path);
      const crudo = JSON.parse(await readFile(path, "utf8")) as { version: number };
      expect(crudo.version).toBe(SETTINGS_VERSION);
    });
  });
});

describe("nada de esto puede impedir arrancar", () => {
  /** La primera vez no hay fichero, y eso **no** es un problema. */
  test("sin fichero se arranca con los valores por defecto, sin queja", async () => {
    const { settings, problem } = await readSettings("/no/existe/settings.json");
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(problem).toBeNull();
  });

  test("un JSON roto no impide abrir, pero se dice", async () => {
    await conFichero(async (path) => {
      await writeFile(path, "{esto no es json");
      const { settings, problem } = await readSettings(path);
      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(problem).toContain("not valid JSON");
    });
  });

  test("un fichero que no es un objeto tampoco", async () => {
    await conFichero(async (path) => {
      await writeFile(path, JSON.stringify(["no", "soy", "ajustes"]));
      const { problem } = await readSettings(path);
      expect(problem).toContain("not an object");
    });
  });

  /**
   * EL test de la versión. Un fichero de una versión **posterior** lo
   * escribió un programa que sabe más que este; adivinar qué significan
   * sus campos es cómo se corrompen los ajustes de alguien. Se ignora
   * y —sobre todo— no se sobrescribe sin avisar.
   */
  test("una versión futura se respeta: no se lee ni se pisa a ciegas", async () => {
    await conFichero(async (path) => {
      await writeFile(
        path,
        JSON.stringify({ version: SETTINGS_VERSION + 5, locale: "xx" }),
      );
      const { settings, problem } = await readSettings(path);

      expect(settings.locale).toBeUndefined();
      expect(problem).toContain("newer version");
      // El fichero sigue como estaba: no se ha tocado al leer.
      const crudo = JSON.parse(await readFile(path, "utf8")) as { locale: string };
      expect(crudo.locale).toBe("xx");
    });
  });
});

describe("alguien lo va a editar a mano, porque es texto en su carpeta", () => {
  /**
   * EL test. Un `theme: "azul"` editado a mano no puede acabar en el
   * atributo del documento: ahí produciría un tema que no existe y una
   * pantalla a medio pintar.
   */
  test("un tema inventado se descarta, no se propaga", async () => {
    await conFichero(async (path) => {
      await writeFile(path, JSON.stringify({ version: 1, theme: "azul" }));
      const { settings } = await readSettings(path);
      expect(settings.theme).toBeUndefined();
    });
  });

  /**
   * Y el descarte es **campo a campo**: quien se equivoca en un ajuste
   * no debería perder los otros cinco.
   */
  test("un campo malo no se lleva por delante los buenos", async () => {
    await conFichero(async (path) => {
      await writeFile(
        path,
        JSON.stringify({ version: 1, theme: "azul", locale: "ja", lastProjectRoot: "/y" }),
      );
      const { settings } = await readSettings(path);

      expect(settings.theme).toBeUndefined();
      expect(settings.locale).toBe("ja");
      expect(settings.lastProjectRoot).toBe("/y");
    });
  });

  test("un tipo equivocado se ignora en vez de viajar", async () => {
    await conFichero(async (path) => {
      await writeFile(
        path,
        JSON.stringify({ version: 1, locale: 42, lastFormats: "postman" }),
      );
      const { settings } = await readSettings(path);
      expect(settings.locale).toBeUndefined();
      expect(settings.lastFormats).toBeUndefined();
    });
  });

  test("una cadena vacía no cuenta como valor elegido", async () => {
    await conFichero(async (path) => {
      await writeFile(path, JSON.stringify({ version: 1, locale: "   " }));
      expect((await readSettings(path)).settings.locale).toBeUndefined();
    });
  });

  /**
   * `locale` sin valor significa «el del sistema», que no es lo mismo
   * que un idioma concreto: quien cambie el idioma de su equipo quiere
   * que la interfaz le siga.
   */
  test("sin idioma guardado se sigue al sistema, no se fija uno", async () => {
    await conFichero(async (path) => {
      await writeSettings({ version: SETTINGS_VERSION, theme: "dark" }, path);
      expect((await readSettings(path)).settings.locale).toBeUndefined();
    });
  });
});
