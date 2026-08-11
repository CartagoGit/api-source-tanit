/**
 * Lo que la interfaz recuerda entre aperturas.
 *
 * Todo es opcional salvo la versión, y esa asimetría es deliberada: un
 * ajuste que falta tiene un valor por defecto razonable, así que un
 * fichero a medias sirve igual. Lo único que no puede faltar es saber
 * **qué forma tiene** ese fichero, porque de eso depende poder leerlo.
 *
 * ## Por qué hay versión
 *
 * El fichero lo escribe una versión del programa y lo lee otra, quizá
 * meses después. Sin un número, un campo que cambie de significado se
 * lee mal y en silencio — y el resultado es una interfaz que arranca
 * con ajustes que nadie eligió.
 */

import type { ThemeMode } from "../../constants/cli/theme.constant.js";

/** La versión del formato. Sube cuando un campo cambia de significado. */
export const SETTINGS_VERSION = 1;

/**
 * Con lo que se arranca cuando no hay nada guardado.
 *
 * Solo la versión: todo lo demás ausente significa «lo que decida el
 * sistema» —el idioma del navegador, el tema del escritorio—, que no es
 * lo mismo que un valor concreto. Fijar aquí `locale: "en"` haría que
 * quien tenga el equipo en japonés viera inglés sin haberlo pedido.
 */
/** Lo que se guarda de una sesión a la siguiente. */
export interface ISettings {
  /** La versión con la que se escribió. */
  readonly version: number;
  /**
   * Código del idioma elegido a mano.
   *
   * `undefined` significa «el del sistema», que no es lo mismo que un
   * idioma concreto: si alguien cambia el idioma de su equipo, quiere
   * que la interfaz le siga.
   */
  readonly locale?: string;
  /** `system`, `light` o `dark`. */
  readonly theme?: ThemeMode;
  /** El último proyecto que se miró, para no volver a escribir la ruta. */
  readonly lastProjectRoot?: string;
  /** La última carpeta de salida, si se eligió una distinta. */
  readonly lastOutputDir?: string;
  /** Los formatos marcados la última vez. */
  readonly lastFormats?: ReadonlyArray<string>;
  /**
   * El framework forzado la última vez.
   *
   * `undefined` es «detectar automáticamente». Recordar un framework
   * forzado importa: quien lo tuvo que forzar una vez lo va a tener que
   * forzar siempre en ese proyecto.
   */
  readonly lastFramework?: string;
}

export const DEFAULT_SETTINGS: ISettings = { version: SETTINGS_VERSION };

/** Lo que se devuelve al leer los ajustes de disco. */
export interface ISettingsRead {
  readonly settings: ISettings;
  /**
   * Por qué no se pudieron usar los guardados, si es que había.
   *
   * `null` cuando todo fue bien **o** cuando simplemente no había
   * fichero —que es lo normal la primera vez y no es un problema—.
   * Cuando hay motivo, la interfaz arranca con los valores por defecto
   * y lo dice: unos ajustes que desaparecen sin explicación parecen un
   * fallo del programa.
   */
  readonly problem: string | null;
}
