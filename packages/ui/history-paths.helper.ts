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

import {
  HISTORY_DIR_NAME,
  HISTORY_FILE_NAME,
} from "../contracts/constants/cli/history.constant.js";

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
    return join(env["APPDATA"] ?? join(home, "AppData", "Roaming"), HISTORY_DIR_NAME);
  }
  if (platform === "darwin") {
    return join(home, HISTORY_DIR_NAME);
  }
  return join(home, HISTORY_DIR_NAME);
}

/** El fichero JSONL donde se acumula el historial. */
export function historyPath(
  env?: Readonly<Record<string, string | undefined>>,
  platform?: string,
  home?: string,
): string {
  return join(userHistoryDir(env, platform, home), HISTORY_FILE_NAME);
}

