/**
 * The interface languages.
 *
 * Three things are tested here, and they are the three that make a
 * translation system help or get in the way:
 *
 *   1. **Picking the right language for whoever arrives.** It is not
 *      string comparison: `pt-BR` must fall back to `pt` before
 *      English, and `zh` must find `zh-Hans`. Both directions.
 *   2. **That a missing key does not break the screen.** A language
 *      at 80% shows the 80% translated and the rest in English —
 *      never the raw key, which is what turns an incomplete
 *      translation into a broken interface.
 *   3. **That adding a language is just dropping a file.** That is
 *      what was asked, and without a test it is the first thing
 *      that stops working.
 */
import { describe, expect, test } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  BUNDLED_LOCALES,
  FALLBACK_LOCALE,
} from "../../packages/contracts/constants/cli/locales.constant";
import {
  loadLocales,
  pickLocale,
  seedLocales,
  translate,
} from "../../packages/ui/i18n/i18n.service";
import {
  userConfigDir,
  userLocalesDir,
} from "../../packages/ui/config-dir.helper";
import { fromRoot } from "../../scripts/helpers/root.helper";

const CODIGOS = BUNDLED_LOCALES.map((l) => l.code);

describe("the language catalog", () => {
  test("it ships fifteen", () => {
    expect(BUNDLED_LOCALES).toHaveLength(15);
  });

  test("none duplicated", () => {
    expect(new Set(CODIGOS).size).toBe(CODIGOS.length);
  });

  /**
   * The name goes in the language it names —"Français", not
   * "French"— because whoever looks for theirs in a list does not
   * know how to say it in the language they are seeing.
   */
  test("each names itself in its own language", () => {
    for (const l of BUNDLED_LOCALES) {
      expect(l.nativeName.length, l.code).toBeGreaterThan(0);
    }
    expect(BUNDLED_LOCALES.find((l) => l.code === "fr")?.nativeName).toBe("Français");
    expect(BUNDLED_LOCALES.find((l) => l.code === "ja")?.nativeName).toBe("日本語");
  });

  test("Arabic and Urdu are marked right-to-left", () => {
    expect(BUNDLED_LOCALES.find((l) => l.code === "ar")?.rtl).toBe(true);
    expect(BUNDLED_LOCALES.find((l) => l.code === "ur")?.rtl).toBe(true);
    expect(BUNDLED_LOCALES.find((l) => l.code === "es")?.rtl).toBeUndefined();
  });

  /**
   * THE sync test. The service enumerates the catalogs by hand —
   * it has to, so the bundler sees them — so the folder and the
   * list can drift apart. It is the kind of parallel list this
   * repository already paid for with `NON_LARAVEL_FRAMEWORKS`.
   */
  test("there is one file per declared language, and none extra", async () => {
    const ficheros = (await readdir(fromRoot("packages/ui/i18n/locales")))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(ficheros).toEqual([...CODIGOS].sort());
  });
});

describe("picking the language of whoever arrives", () => {
  test("exact match", () => {
    expect(pickLocale(["es"], CODIGOS)).toBe("es");
  });

  /** `pt-BR` prefers Portuguese to English. The obvious direction. */
  test("a variant falls back to its base language", () => {
    expect(pickLocale(["pt-BR"], CODIGOS)).toBe("pt");
  });

  /**
   * And the opposite direction, which is the one we forget: asking
   * for `zh` bare must find `zh-Hans`. Without this, someone with
   * the browser in Chinese would end up in English while Chinese
   * is available.
   */
  test("a base language finds its variant", () => {
    expect(pickLocale(["zh"], CODIGOS)).toBe("zh-Hans");
  });

  test("respects the browser's preference order", () => {
    expect(pickLocale(["xx", "fr", "es"], CODIGOS)).toBe("fr");
  });

  test("is case-insensitive: `ES` is `es`", () => {
    expect(pickLocale(["ES"], CODIGOS)).toBe("es");
  });

  test("with nothing to match, English", () => {
    expect(pickLocale(["xx", "yy"], CODIGOS)).toBe(FALLBACK_LOCALE);
    expect(pickLocale([], CODIGOS)).toBe(FALLBACK_LOCALE);
  });

  test("an empty preference does not count as a match", () => {
    expect(pickLocale(["", "  ", "es"], CODIGOS)).toBe("es");
  });
});

describe("loading the languages", () => {
  test("the fifteen come bundled", async () => {
    const { locales } = await loadLocales();
    expect(locales).toHaveLength(15);
    expect(locales.every((l) => l.origin === "bundled")).toBe(true);
  });

  test("all carry text for the English keys", async () => {
    const { locales } = await loadLocales();
    const clavesEn = Object.keys(
      locales.find((l) => l.code === "en")?.translations ?? {},
    );
    for (const l of locales) {
      for (const clave of clavesEn) {
        expect(translate(l, clave), `${l.code} → ${clave}`).not.toBe("");
      }
    }
  });

  /**
   * THE fallback test. A language missing a key shows English, **not**
   * the raw key: seeing `settings.theme` in the middle of a screen is
   * what turns an incomplete translation into something that looks
   * broken.
   */
  test("a missing key falls back to English, never to the raw key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locales-"));
    try {
      await writeFile(
        join(dir, "es.json"),
        JSON.stringify({ "nav.settings": "Ajustes propios" }),
      );
      const { locales } = await loadLocales(dir);
      const es = locales.find((l) => l.code === "es")!;

      expect(translate(es, "nav.settings")).toBe("Ajustes propios");
      // This one is not present: English comes out.
      expect(translate(es, "action.generate")).toBe("Generate");
      expect(translate(es, "action.generate")).not.toBe("action.generate");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a key that does not exist anywhere returns the key, not empty", async () => {
    const { locales } = await loadLocales();
    const en = locales.find((l) => l.code === "en")!;
    expect(translate(en, "no.existe.en.ninguna.parte")).toBe("no.existe.en.ninguna.parte");
  });
});

describe("adding a language is just dropping a file", () => {
  /** What was asked: a new language without touching code. */
  test("a language that did not ship appears in the list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locales-"));
    try {
      await writeFile(join(dir, "eu.json"), JSON.stringify({ "nav.settings": "Ezarpenak" }));
      const { locales } = await loadLocales(dir);

      const eu = locales.find((l) => l.code === "eu");
      expect(eu, "external language did not load").toBeDefined();
      expect(eu!.origin).toBe("external");
      expect(translate(eu!, "nav.settings")).toBe("Ezarpenak");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an external one overrides the bundled one of the same code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locales-"));
    try {
      await writeFile(join(dir, "fr.json"), JSON.stringify({ "nav.settings": "Réglages" }));
      const { locales } = await loadLocales(dir);
      const fr = locales.find((l) => l.code === "fr")!;

      expect(fr.origin).toBe("external");
      expect(translate(fr, "nav.settings")).toBe("Réglages");
      // And there are still fifteen: not duplicated.
      expect(locales).toHaveLength(15);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a folder that does not exist is not an error: it is the normal case", async () => {
    const { locales, rejected } = await loadLocales("/no/existe/idiomas");
    expect(locales).toHaveLength(15);
    expect(rejected).toEqual([]);
  });
});

/**
 * The languages after installing.
 *
 * The first time it starts, the application drops the fifteen in
 * the system's configuration folder. That is what turns "the
 * languages are inside the program" into "the languages are files
 * you can open": without them on disk, whoever installs the `.deb`
 * knows there are fifteen but not where, and adding one would be
 * guessing the name of a folder that does not exist.
 */
describe("the languages end up on disk, to be editable", () => {
  test("the first time drops the fifteen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seed-"));
    try {
      await seedLocales(join(dir, "locales"));
      const ficheros = (await readdir(join(dir, "locales"))).sort();
      expect(ficheros).toHaveLength(15);
      expect(ficheros).toContain("es.json");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * THE test. If it seeded on every start, the first correction
   * someone makes to a translation would disappear on reopen — and
   * that is worse than not letting them edit them.
   */
  test("does not overwrite what is already there: a correction survives restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seed-"));
    const locales = join(dir, "locales");
    try {
      await seedLocales(locales);
      await writeFile(
        join(locales, "es.json"),
        JSON.stringify({ "nav.settings": "Mi propia palabra" }),
      );

      await seedLocales(locales);

      const { locales: cargados } = await loadLocales(locales);
      const es = cargados.find((l) => l.code === "es")!;
      expect(translate(es, "nav.settings")).toBe("Mi propia palabra");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a language added by hand survives the seeding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seed-"));
    const locales = join(dir, "locales");
    try {
      await seedLocales(locales);
      await writeFile(join(locales, "eu.json"), JSON.stringify({ "nav.back": "Atzera" }));
      await seedLocales(locales);

      const { locales: cargados } = await loadLocales(locales);
      expect(cargados.find((l) => l.code === "eu")).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * And if someone deletes the whole folder, the interface stays
   * the same: the fifteen are bundled. The disk is an editable
   * copy, not the source, so nothing needs to be reinstalled.
   */
  test("deleting the whole folder does not leave the interface without languages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "seed-"));
    const locales = join(dir, "locales");
    try {
      await seedLocales(locales);
      await rm(locales, { recursive: true, force: true });

      const { locales: cargados, rejected } = await loadLocales(locales);
      expect(cargados).toHaveLength(15);
      expect(rejected).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("a broken language does not bring the interface down, but it is reported", () => {
  test("an invalid JSON is rejected with its reason", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locales-"));
    try {
      await writeFile(join(dir, "xx.json"), "{esto no es json");
      const { locales, rejected } = await loadLocales(dir);

      // The fifteen are still there: the interface starts the same.
      expect(locales).toHaveLength(15);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.file).toBe("xx.json");
      expect(rejected[0]!.reason).toContain("JSON");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a file that is not a flat map of texts is rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locales-"));
    try {
      await writeFile(join(dir, "yy.json"), JSON.stringify(["no", "soy", "un", "mapa"]));
      const { rejected } = await loadLocales(dir);
      expect(rejected[0]!.reason).toContain("flat object");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * The rejection must reach whoever wrote the file. If it
   * disappeared, that person would see their language missing from
   * the list without any hint of why.
   */
  test("the reason names the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locales-"));
    try {
      await writeFile(join(dir, "zz.json"), "{");
      const { rejected } = await loadLocales(dir);
      expect(rejected[0]!.file).toBe("zz.json");
      expect(rejected[0]!.reason.length).toBeGreaterThan(10);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Where those files end up on each system.
 *
 * The three conventions are not interchangeable: a `~/.config` on
 * Windows leaves a hidden folder in the profile that nobody
 * finds, and `%APPDATA%` on Linux means nothing. `env` and
 * `platform` are injected because it is the only way to test all
 * three without changing operating system.
 */
describe("the config folder of each system", () => {
  test("Linux respects XDG_CONFIG_HOME when set", () => {
    expect(userConfigDir({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/x")).toBe(
      "/xdg/tanit",
    );
  });

  test("Linux falls back to ~/.config when not", () => {
    expect(userConfigDir({}, "linux", "/home/x")).toBe("/home/x/.config/tanit");
  });

  test("macOS usa Application Support", () => {
    expect(userConfigDir({}, "darwin", "/Users/x")).toBe(
      "/Users/x/Library/Application Support/tanit",
    );
  });

  test("Windows usa APPDATA", () => {
    expect(userConfigDir({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }, "win32", "C:\\Users\\x")).toContain(
      "tanit",
    );
  });

  test("the languages hang off it, not from somewhere else", () => {
    const base = userConfigDir({}, "linux", "/home/x");
    expect(userLocalesDir({}, "linux", "/home/x")).toBe(`${base}/locales`);
  });
});
