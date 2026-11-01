/**
 * The settings that survive close.
 *
 * What is checked is not that they are saved —that is one line— but
 * the four ways persistent settings get corrupted:
 *
 *   1. **That there is no file** the first time, and that is not an
 *      error.
 *   2. **That the file is broken** and the interface keeps opening.
 *   3. **That someone edits it by hand** and types an impossible
 *      value: it is text, in their folder, and they will edit it.
 *   4. **That a later version wrote it**, which is when guessing the
 *      meaning of a field corrupts someone's settings.
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

/** A settings file in a temp, different per test. */
async function conFichero<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ajustes-"));
  try {
    return await fn(join(dir, "settings.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("where the file lives", () => {
  test("hangs from the config folder, not from the package", () => {
    expect(settingsPath("/cfg/expostman")).toBe("/cfg/expostman/settings.json");
  });
});

describe("save and retrieve", () => {
  test("what is saved comes back on reopen", async () => {
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

  test("saving creates the folder if it does not exist", async () => {
    await conFichero(async (path) => {
      const anidado = join(path, "..", "sub", "carpeta", "settings.json");
      await writeSettings({ version: SETTINGS_VERSION, locale: "fr" }, anidado);
      expect((await readSettings(anidado)).settings.locale).toBe("fr");
    });
  });

  /**
   * Changing one setting must not erase the others. Saving the
   * whole object from the browser would make two tabs step on
   * what the other just changed.
   */
  test("changing one preserves the rest", async () => {
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

  test("the version is always written, even if not passed", async () => {
    await conFichero(async (path) => {
      await writeSettings({ version: 0, locale: "de" }, path);
      const crudo = JSON.parse(await readFile(path, "utf8")) as { version: number };
      expect(crudo.version).toBe(SETTINGS_VERSION);
    });
  });
});

describe("none of this may prevent startup", () => {
  /** The first time there is no file, and that is **not** a problem. */
  test("without a file it starts with defaults, without complaining", async () => {
    const { settings, problem } = await readSettings("/no/existe/settings.json");
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(problem).toBeNull();
  });

  test("a broken JSON does not prevent opening, but it is told", async () => {
    await conFichero(async (path) => {
      await writeFile(path, "{esto no es json");
      const { settings, problem } = await readSettings(path);
      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(problem).toContain("not valid JSON");
    });
  });

  test("a file that is not an object either", async () => {
    await conFichero(async (path) => {
      await writeFile(path, JSON.stringify(["no", "soy", "ajustes"]));
      const { problem } = await readSettings(path);
      expect(problem).toContain("not an object");
    });
  });

  /**
   * THE version test. A file of a **later** version was written by
   * a program that knows more than this one; guessing what its
   * fields mean is how someone's settings get corrupted. It is
   * ignored and —above all— not overwritten without warning.
   */
  test("a future version is respected: not read nor overwritten blindly", async () => {
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

describe("someone will edit it by hand, because it is text in their folder", () => {
  /**
   * THE test. A `theme: "blue"` edited by hand must not end up in
   * the document attribute: there it would produce a theme that
   * does not exist and a half-rendered screen.
   */
  test("a made-up theme is discarded, not propagated", async () => {
    await conFichero(async (path) => {
      await writeFile(path, JSON.stringify({ version: 1, theme: "azul" }));
      const { settings } = await readSettings(path);
      expect(settings.theme).toBeUndefined();
    });
  });

  /**
   * And the discard is **field by field**: whoever gets one setting
   * wrong should not lose the other five.
   */
  test("a bad field does not take down the good ones", async () => {
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

  test("a wrong type is ignored instead of traveling", async () => {
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

  test("an empty string does not count as a chosen value", async () => {
    await conFichero(async (path) => {
      await writeFile(path, JSON.stringify({ version: 1, locale: "   " }));
      expect((await readSettings(path)).settings.locale).toBeUndefined();
    });
  });

  /**
   * `locale` without a value means "the system's", which is not the
   * same as a specific language: whoever changes the team's
   * language wants the interface to follow.
   */
  test("without a saved language it follows the system, does not pin one", async () => {
    await conFichero(async (path) => {
      await writeSettings({ version: SETTINGS_VERSION, theme: "dark" }, path);
      expect((await readSettings(path)).settings.locale).toBeUndefined();
    });
  });
});
