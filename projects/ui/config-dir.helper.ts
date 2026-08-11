/**
 * Dónde guarda la interfaz lo que es de quien la usa.
 *
 * Los idiomas y los ajustes viven **fuera del programa**, en la carpeta
 * de configuración del sistema. Es lo que permite que alguien abra la
 * carpeta, edite un idioma o añada el suyo, y lo tenga la próxima vez
 * que arranque.
 *
 * ## Por qué fuera y no dentro del paquete
 *
 * Porque un `.deb` reinstalado **reemplaza su contenido**. Si los
 * idiomas vivieran dentro, actualizar la aplicación borraría el idioma
 * que alguien hubiera añadido, y encima sin avisar. Lo mismo con los
 * ajustes: perderlos en cada actualización los convierte en algo que no
 * merece la pena configurar.
 *
 * ## Las tres convenciones
 *
 * Cada sistema tiene la suya y no son intercambiables: poner un
 * `~/.config` en Windows deja una carpeta oculta en el perfil que nadie
 * encuentra, y `%APPDATA%` en Linux no significa nada.
 *
 * | Sistema | Carpeta |
 * |---|---|
 * | Linux | `$XDG_CONFIG_HOME/expostman` o `~/.config/expostman` |
 * | macOS | `~/Library/Application Support/expostman` |
 * | Windows | `%APPDATA%\expostman` |
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** El nombre de la carpeta, igual en los tres sistemas. */
const CARPETA = "expostman";

/**
 * La carpeta de configuración de quien usa la aplicación.
 *
 * `env` y `platform` se inyectan para poder probar las tres
 * convenciones sin cambiar de sistema operativo — que es la única forma
 * de tener un test de esto que valga algo.
 */
export function userConfigDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    return join(env["APPDATA"] ?? join(home, "AppData", "Roaming"), CARPETA);
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", CARPETA);
  }
  // Linux y el resto: la especificación XDG, respetando la variable si
  // está — hay quien mueve su configuración a propósito.
  return join(env["XDG_CONFIG_HOME"] ?? join(home, ".config"), CARPETA);
}

/** Donde viven los ficheros de idioma que puede tocar quien quiera. */
export function userLocalesDir(
  env?: Readonly<Record<string, string | undefined>>,
  platform?: string,
  home?: string,
): string {
  return join(userConfigDir(env, platform, home), "locales");
}
