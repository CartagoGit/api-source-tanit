/**
 * Los idiomas de la interfaz.
 *
 * Tres cosas se comprueban aquí, y las tres son las que hacen que un
 * sistema de traducciones sirva o estorbe:
 *
 *   1. **Elegir bien el idioma de quien llega.** No es comparar cadenas:
 *      `pt-BR` tiene que caer en `pt` antes que en inglés, y `zh` tiene
 *      que encontrar `zh-Hans`. Las dos direcciones.
 *   2. **Que una clave suelta no rompa la pantalla.** Un idioma al 80 %
 *      enseña el 80 % traducido y el resto en inglés — nunca la clave
 *      cruda, que es lo que convierte una traducción incompleta en una
 *      interfaz rota.
 *   3. **Que añadir un idioma sea dejar un fichero.** Es lo que se pidió,
 *      y sin un test es lo primero que deja de funcionar.
 */
import { describe, expect, test } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  BUNDLED_LOCALES,
  FALLBACK_LOCALE,
} from "../../projects/contracts/constants/cli/locales.constant";
import {
  loadLocales,
  pickLocale,
  seedLocales,
  translate,
} from "../../projects/ui/i18n/i18n.service";
import {
  userConfigDir,
  userLocalesDir,
} from "../../projects/ui/config-dir.helper";
import { fromRoot } from "../../scripts/helpers/root.helper";

const CODIGOS = BUNDLED_LOCALES.map((l) => l.code);

describe("el catálogo de idiomas", () => {
  test("trae quince", () => {
    expect(BUNDLED_LOCALES).toHaveLength(15);
  });

  test("ninguno repetido", () => {
    expect(new Set(CODIGOS).size).toBe(CODIGOS.length);
  });

  /**
   * El nombre va en el idioma que nombra —«Français», no «Francés»—
   * porque quien busca el suyo en una lista no sabe cómo se dice en el
   * idioma que está viendo.
   */
  test("cada uno se nombra en su propio idioma", () => {
    for (const l of BUNDLED_LOCALES) {
      expect(l.nativeName.length, l.code).toBeGreaterThan(0);
    }
    expect(BUNDLED_LOCALES.find((l) => l.code === "fr")?.nativeName).toBe("Français");
    expect(BUNDLED_LOCALES.find((l) => l.code === "ja")?.nativeName).toBe("日本語");
  });

  test("el árabe y el urdu se marcan de derecha a izquierda", () => {
    expect(BUNDLED_LOCALES.find((l) => l.code === "ar")?.rtl).toBe(true);
    expect(BUNDLED_LOCALES.find((l) => l.code === "ur")?.rtl).toBe(true);
    expect(BUNDLED_LOCALES.find((l) => l.code === "es")?.rtl).toBeUndefined();
  });

  /**
   * EL test de sincronía. El servicio enumera los catálogos a mano
   * —tiene que hacerlo, para que el empaquetador los vea— así que la
   * carpeta y la lista pueden separarse. Es la clase de lista paralela
   * que este repositorio ya pagó con `NON_LARAVEL_FRAMEWORKS`.
   */
  test("hay un fichero por cada idioma declarado, y ninguno de más", async () => {
    const ficheros = (await readdir(fromRoot("projects/ui/i18n/locales")))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(ficheros).toEqual([...CODIGOS].sort());
  });
});

describe("elegir el idioma de quien llega", () => {
  test("coincidencia exacta", () => {
    expect(pickLocale(["es"], CODIGOS)).toBe("es");
  });

  /** `pt-BR` prefiere portugués a inglés. Es la dirección obvia. */
  test("una variante cae en su idioma base", () => {
    expect(pickLocale(["pt-BR"], CODIGOS)).toBe("pt");
  });

  /**
   * Y la dirección contraria, que es la que se olvida: pedir `zh` a
   * secas tiene que encontrar `zh-Hans`. Sin esto, alguien con el
   * navegador en chino acabaría en inglés teniendo chino disponible.
   */
  test("un idioma base encuentra su variante", () => {
    expect(pickLocale(["zh"], CODIGOS)).toBe("zh-Hans");
  });

  test("respeta el orden de preferencia del navegador", () => {
    expect(pickLocale(["xx", "fr", "es"], CODIGOS)).toBe("fr");
  });

  test("no distingue mayúsculas: `ES` es `es`", () => {
    expect(pickLocale(["ES"], CODIGOS)).toBe("es");
  });

  test("sin nada que casar, inglés", () => {
    expect(pickLocale(["xx", "yy"], CODIGOS)).toBe(FALLBACK_LOCALE);
    expect(pickLocale([], CODIGOS)).toBe(FALLBACK_LOCALE);
  });

  test("una preferencia vacía no cuenta como coincidencia", () => {
    expect(pickLocale(["", "  ", "es"], CODIGOS)).toBe("es");
  });
});

describe("cargar los idiomas", () => {
  test("los quince vienen empaquetados", async () => {
    const { locales } = await loadLocales();
    expect(locales).toHaveLength(15);
    expect(locales.every((l) => l.origin === "bundled")).toBe(true);
  });

  test("todos traen texto para las claves del inglés", async () => {
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
   * EL test del respaldo. Un idioma al que le falta una clave enseña el
   * inglés, **no** la clave cruda: ver `settings.theme` en mitad de una
   * pantalla es lo que convierte una traducción incompleta en algo que
   * parece roto.
   */
  test("una clave que falta cae al inglés, nunca a la clave cruda", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locales-"));
    try {
      await writeFile(
        join(dir, "es.json"),
        JSON.stringify({ "nav.settings": "Ajustes propios" }),
      );
      const { locales } = await loadLocales(dir);
      const es = locales.find((l) => l.code === "es")!;

      expect(translate(es, "nav.settings")).toBe("Ajustes propios");
      // Esta no la trae: sale la inglesa.
      expect(translate(es, "action.generate")).toBe("Generate");
      expect(translate(es, "action.generate")).not.toBe("action.generate");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("una clave que no existe en ningún sitio devuelve la clave, no vacío", async () => {
    const { locales } = await loadLocales();
    const en = locales.find((l) => l.code === "en")!;
    expect(translate(en, "no.existe.en.ninguna.parte")).toBe("no.existe.en.ninguna.parte");
  });
});

describe("añadir un idioma es dejar un fichero", () => {
  /** Lo que se pidió: un idioma nuevo sin tocar código. */
  test("un idioma que no venía aparece en la lista", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locales-"));
    try {
      await writeFile(join(dir, "eu.json"), JSON.stringify({ "nav.settings": "Ezarpenak" }));
      const { locales } = await loadLocales(dir);

      const eu = locales.find((l) => l.code === "eu");
      expect(eu, "el idioma externo no se cargó").toBeDefined();
      expect(eu!.origin).toBe("external");
      expect(translate(eu!, "nav.settings")).toBe("Ezarpenak");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("un externo pisa al empaquetado del mismo código", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locales-"));
    try {
      await writeFile(join(dir, "fr.json"), JSON.stringify({ "nav.settings": "Réglages" }));
      const { locales } = await loadLocales(dir);
      const fr = locales.find((l) => l.code === "fr")!;

      expect(fr.origin).toBe("external");
      expect(translate(fr, "nav.settings")).toBe("Réglages");
      // Y sigue habiendo quince: no se duplica.
      expect(locales).toHaveLength(15);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("una carpeta que no existe no es un error: es lo normal", async () => {
    const { locales, rejected } = await loadLocales("/no/existe/idiomas");
    expect(locales).toHaveLength(15);
    expect(rejected).toEqual([]);
  });
});

/**
 * Los idiomas tras instalar.
 *
 * La primera vez que arranca, la aplicación deja los quince en la
 * carpeta de configuración del sistema. Eso es lo que convierte «los
 * idiomas están dentro del programa» en «los idiomas son ficheros que
 * puedes abrir»: sin ellos en disco, quien instala el `.deb` sabe que
 * hay quince pero no dónde, y añadir uno sería adivinar el nombre de
 * una carpeta que no existe.
 */
describe("los idiomas acaban en disco, para poder tocarlos", () => {
  test("la primera vez deja los quince", async () => {
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
   * EL test. Si sembrara en cada arranque, la primera corrección que
   * alguien hiciera a una traducción desaparecería al reabrir — y eso
   * es peor que no dejar editarlos.
   */
  test("no pisa lo que ya está: una corrección sobrevive al reinicio", async () => {
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

  test("un idioma añadido a mano sobrevive a la siembra", async () => {
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
   * Y si alguien borra la carpeta entera, la interfaz sigue igual: los
   * quince están empaquetados. El disco es una copia editable, no la
   * fuente, así que no hay que reinstalar nada.
   */
  test("borrar la carpeta entera no deja la interfaz sin idiomas", async () => {
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

describe("un idioma roto no tumba la interfaz, pero se dice", () => {
  test("un JSON inválido se rechaza con su motivo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locales-"));
    try {
      await writeFile(join(dir, "xx.json"), "{esto no es json");
      const { locales, rejected } = await loadLocales(dir);

      // Los quince siguen ahí: la interfaz arranca igual.
      expect(locales).toHaveLength(15);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.file).toBe("xx.json");
      expect(rejected[0]!.reason).toContain("JSON");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("un fichero que no es un mapa de textos se rechaza", async () => {
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
   * El rechazo tiene que llegar a quien escribió el fichero. Si
   * desapareciera, esa persona vería su idioma ausente de la lista sin
   * ninguna pista de por qué.
   */
  test("el motivo nombra el fichero", async () => {
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
 * Dónde acaban esos ficheros en cada sistema.
 *
 * Las tres convenciones no son intercambiables: un `~/.config` en
 * Windows deja una carpeta oculta en el perfil que nadie encuentra, y
 * `%APPDATA%` en Linux no significa nada. Se inyectan `env` y
 * `platform` porque es la única forma de probar las tres sin cambiar de
 * sistema operativo.
 */
describe("la carpeta de configuración de cada sistema", () => {
  test("Linux respeta XDG_CONFIG_HOME cuando está", () => {
    expect(userConfigDir({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/x")).toBe(
      "/xdg/expostman",
    );
  });

  test("Linux cae a ~/.config cuando no", () => {
    expect(userConfigDir({}, "linux", "/home/x")).toBe("/home/x/.config/expostman");
  });

  test("macOS usa Application Support", () => {
    expect(userConfigDir({}, "darwin", "/Users/x")).toBe(
      "/Users/x/Library/Application Support/expostman",
    );
  });

  test("Windows usa APPDATA", () => {
    expect(userConfigDir({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }, "win32", "C:\\Users\\x")).toContain(
      "expostman",
    );
  });

  test("los idiomas cuelgan de ella, no de otro sitio", () => {
    const base = userConfigDir({}, "linux", "/home/x");
    expect(userLocalesDir({}, "linux", "/home/x")).toBe(`${base}/locales`);
  });
});
