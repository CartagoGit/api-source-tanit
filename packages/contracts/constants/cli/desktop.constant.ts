/**
 * Desktop platforms and which installer each one produces.
 *
 * Lives in contracts because three places need to agree: the packaging
 * script, the CI workflow that triggers it, and the installation docs.
 * If one says `.msi` and another `.exe`, somebody ends up hunting for
 * a file that does not exist.
 *
 * ## Cannot cross platforms
 *
 * A `.dmg` cannot be built from Linux, nor a `.msi` from macOS. Each
 * installer requires its own platform SDK and signing key, and Tauri
 * links against the machine's native libraries. That is why all three
 * come out of the workflow, one runner per platform, and
 * `desktop:build:<x>` locally only works on the matching machine.
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
