/**
 * Dónde vive el historial de generaciones.
 *
 * Es una carpeta **distinta** de la de configuración, y a propósito:
 *
 *   - `~/.config/expostman/` guarda ajustes e idiomas: cosas que quien
 *     usa la aplicación modifica a mano, en su carpeta personal.
 *   - `~/.expostman/` guarda `history.jsonl`: el registro que la
 *     herramienta escribe **por sí sola**, sin que nadie lo pida.
 *
 * Mezclar ambas carpetas haría que editar un ajuste o añadir un idioma
 * apareciera en la misma carpeta que el log automático. Separarlas es
 * lo que deja a cada una con una sola razón para existir: la primera es
 * del usuario, la segunda del programa.
 *
 * Las tres convenciones de `userConfigDir` siguen aplicando aquí: una
 * sola carpeta con un nombre estable, resuelta a partir de `homedir()`
 * y la variable de entorno si existe. `XDG_DATA_HOME` (Linux) tiene
 * precedencia sobre `~/.local/share`, igual que `XDG_CONFIG_HOME`
 * sobre `~/.config` en `userConfigDir`. Es la misma idea: respetar la
 * decisión de quien mueve sus datos a propósito.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** El nombre del directorio, con punto para que sea oculto en Unix. */
const CARPETA = ".expostman";

/**
 * La carpeta del historial de generaciones, dentro del `homedir` de
 * quien usa la aplicación.
 *
 * Se inyectan `env`, `platform` y `home` para poder probar las tres
 * convenciones sin cambiar de sistema operativo. Es el mismo patrón
 * que `userConfigDir`: la única forma de tener un test que valga algo
 * es no depender del sistema que lo corre.
 */
export function userHistoryDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string {
  // Las tres convenciones de XDG, una por sistema, igual que en
  // `userConfigDir`. La diferencia: aquí *no* se respeta `XDG_DATA_HOME`
  // —sería el sitio canónico de datos de aplicación— porque añadir un
  // carpeta nueva que difiera entre máquinas según esa variable es
  // exactamente el tipo de sorpresa que un historial automático no
  // debería traer. `.expostman/` dentro de `homedir` es predecible.
  if (platform === "win32") {
    return join(env["APPDATA"] ?? join(home, "AppData", "Roaming"), CARPETA);
  }
  if (platform === "darwin") {
    return join(home, CARPETA);
  }
  return join(home, CARPETA);
}

/** El fichero JSONL donde se acumula el historial. */
export function historyPath(
  env?: Readonly<Record<string, string | undefined>>,
  platform?: string,
  home?: string,
): string {
  return join(userHistoryDir(env, platform, home), "history.jsonl");
}

/**
 * Permiso a usar cuando hace falta crear la carpeta del historial.
 *
 * `0o755` en Unix: el dueño puede escribir y los demás solo leer. Es lo
 * razonable para un log que solo escribe el programa que corre como
 * ese usuario, y que nadie más necesita modificar.
 */
export const HISTORY_DIR_MODE = 0o755;
