/**
 * Las plataformas de escritorio y qué instalador produce cada una.
 *
 * Vive en contratos porque lo comparten tres sitios que tienen que
 * coincidir: el script que empaqueta, el workflow que lo lanza en CI, y
 * la documentación de instalación. Que uno diga `.msi` y otro `.exe` es
 * cómo alguien acaba buscando un fichero que no existe.
 *
 * ## No se puede cruzar
 *
 * Un `.dmg` no se construye desde Linux, ni un `.msi` desde macOS. Cada
 * instalador exige el SDK de su sistema y su firma, y Tauri enlaza
 * contra las librerías nativas de la máquina. Por eso los tres salen del
 * workflow, con una máquina por plataforma, y `desktop:build:<x>` en
 * local solo vale para la propia.
 */

/** Una plataforma de escritorio soportada. */
export interface IDesktopPlatform {
  /** Identificador corto, el que va en el nombre del script. */
  readonly id: "linux" | "mac" | "windows";
  /** Cómo se llama para una persona. */
  readonly label: string;
  /** El valor de `process.platform` que le corresponde. */
  readonly platform: string;
  /**
   * Los formatos que produce Tauri ahí.
   *
   * Linux lleva dos porque cubren cosas distintas: el `.deb` se integra
   * con el gestor de paquetes de Debian y derivadas, y el `.AppImage`
   * corre en cualquier distribución sin instalar nada.
   */
  readonly bundles: ReadonlyArray<string>;
  /** El corredor de GitHub Actions que la construye. */
  readonly runner: string;
}

/** Las tres plataformas, con lo que sale en cada una. */
export const DESKTOP_PLATFORMS: ReadonlyArray<IDesktopPlatform> = [
  {
    id: "linux",
    label: "Linux",
    platform: "linux",
    bundles: ["deb", "appimage"],
    runner: "ubuntu-latest",
  },
  {
    id: "mac",
    label: "macOS",
    platform: "darwin",
    bundles: ["dmg", "app"],
    runner: "macos-latest",
  },
  {
    id: "windows",
    label: "Windows",
    platform: "win32",
    bundles: ["msi", "nsis"],
    runner: "windows-latest",
  },
];
