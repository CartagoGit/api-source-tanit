/**
 * Los ajustes de la interfaz: leerlos y guardarlos.
 *
 * Viven en un fichero **fuera del programa**, en la carpeta de
 * configuración del sistema, por lo mismo que los idiomas: un `.deb`
 * reinstalado reemplaza su contenido, así que unos ajustes dentro del
 * paquete se perderían en cada actualización. Y unos ajustes que se
 * pierden solos no merece la pena configurarlos.
 *
 * ## Nada de esto puede impedir arrancar
 *
 * Un fichero corrupto, de una versión que no se entiende, o una carpeta
 * sin permiso de escritura: en los tres casos la interfaz abre con los
 * valores por defecto y **lo dice**. Unos ajustes que desaparecen sin
 * explicación parecen un fallo del programa, y quien los perdió no
 * tiene forma de saber si fue cosa suya.
 *
 * ## Se guarda solo
 *
 * No hay botón de guardar. Un botón se olvida, y entonces el ajuste que
 * alguien cambió no está la próxima vez — que es exactamente el fallo
 * que unos ajustes persistentes vienen a evitar.
 */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../../core/helpers/atomic-write.helper.js";
import { parseJson } from "../../core/helpers/parse-json.helper.js";
import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  type ISettings,
  type ISettingsRead,
} from "../../contracts/interfaces/cli/settings.interface.js";
import {
  THEME_MODES,
  type ThemeMode,
} from "../../contracts/constants/cli/theme.constant.js";
import { userConfigDir } from "../config-dir.helper.js";

/** Cómo se llama el fichero dentro de la carpeta de configuración. */
const FICHERO = "settings.json";

/** Dónde vive el fichero de ajustes en este sistema. */
export function settingsPath(configDir: string = userConfigDir()): string {
  return join(configDir, FICHERO);
}

/**
 * Se queda solo con lo que reconoce, y descarta el resto.
 *
 * No es paranoia: el fichero lo puede haber editado una persona a mano
 * —es texto, en su carpeta— y un `theme: "azul"` no puede acabar en el
 * atributo del documento. Lo que no se entiende se ignora **campo a
 * campo**, en vez de rechazar el fichero entero: alguien que se
 * equivoca en un ajuste no debería perder los otros cinco.
 */
function saneados(crudo: Record<string, unknown>): ISettings {
  const texto = (clave: string): string | undefined => {
    const valor = crudo[clave];
    return typeof valor === "string" && valor.trim() !== "" ? valor : undefined;
  };

  const tema = crudo["theme"];
  const temaValido =
    typeof tema === "string" && (THEME_MODES as ReadonlyArray<string>).includes(tema)
      ? (tema as ThemeMode)
      : undefined;

  const formatos = crudo["lastFormats"];
  const formatosValidos = Array.isArray(formatos)
    ? formatos.filter((f): f is string => typeof f === "string")
    : undefined;

  return {
    version: SETTINGS_VERSION,
    ...(texto("locale") ? { locale: texto("locale")! } : {}),
    ...(temaValido ? { theme: temaValido } : {}),
    ...(texto("lastProjectRoot") ? { lastProjectRoot: texto("lastProjectRoot")! } : {}),
    ...(texto("lastOutputDir") ? { lastOutputDir: texto("lastOutputDir")! } : {}),
    ...(formatosValidos && formatosValidos.length > 0
      ? { lastFormats: formatosValidos }
      : {}),
    ...(texto("lastFramework") ? { lastFramework: texto("lastFramework")! } : {}),
  };
}

/**
 * Lee los ajustes guardados.
 *
 * Que no haya fichero **no es un problema**: es lo normal la primera
 * vez. Por eso `problem` queda en `null` en ese caso y solo se rellena
 * cuando había algo y no se pudo usar.
 */
export async function readSettings(path: string = settingsPath()): Promise<ISettingsRead> {
  let crudo: string;
  try {
    crudo = await readFile(path, "utf8");
  } catch {
    return { settings: DEFAULT_SETTINGS, problem: null };
  }

  const leido = parseJson(crudo);
  if (!leido.ok) {
    return {
      settings: DEFAULT_SETTINGS,
      problem: `the settings file is not valid JSON (${leido.reason}); defaults are in use`,
    };
  }
  if (typeof leido.value !== "object" || leido.value === null || Array.isArray(leido.value)) {
    return {
      settings: DEFAULT_SETTINGS,
      problem: "the settings file is not an object; defaults are in use",
    };
  }

  const objeto = leido.value as Record<string, unknown>;
  const version = objeto["version"];

  // Una versión **posterior** sí es motivo para no fiarse: la escribió
  // un programa que sabe más que este, y adivinar qué significan sus
  // campos es cómo se corrompen los ajustes de alguien.
  if (typeof version === "number" && version > SETTINGS_VERSION) {
    return {
      settings: DEFAULT_SETTINGS,
      problem:
        `the settings file was written by a newer version (${version} > ` +
        `${SETTINGS_VERSION}); defaults are in use so nothing gets overwritten`,
    };
  }

  return { settings: saneados(objeto), problem: null };
}

/**
 * Guarda los ajustes, creando la carpeta si hace falta.
 *
 * Escritura atómica: si el programa se cierra a mitad, el fichero
 * anterior sigue entero. Un fichero de ajustes a medias es peor que uno
 * viejo — el viejo se lee, el partido se descarta y se pierde todo.
 */
export async function writeSettings(
  settings: ISettings,
  path: string = settingsPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const aGuardar: ISettings = { ...settings, version: SETTINGS_VERSION };
  await writeFileAtomic(path, `${JSON.stringify(aGuardar, null, 2)}\n`);
}

/**
 * Cambia unos cuantos ajustes y los guarda, conservando el resto.
 *
 * Es lo que usa la interfaz al tocar un control: guardar el objeto
 * entero desde el navegador haría que dos pestañas se pisaran los
 * ajustes que la otra acaba de cambiar.
 */
export async function patchSettings(
  cambios: Partial<Omit<ISettings, "version">>,
  path: string = settingsPath(),
): Promise<ISettings> {
  const { settings } = await readSettings(path);
  const fusionados: ISettings = { ...settings, ...cambios, version: SETTINGS_VERSION };
  await writeSettings(fusionados, path);
  return fusionados;
}
