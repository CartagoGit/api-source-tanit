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

/** A supported desktop platform. */
export interface IDesktopPlatform {
  /** Short identifier, the one used in the script name. */
  readonly id: "linux" | "mac" | "windows";
  /** Human-readable name. */
  readonly label: string;
  /** The matching `process.platform` value. */
  readonly platform: string;
  /**
   * Formats Tauri produces there.
   *
   * Linux gets two because they cover distinct things: `.deb`
   * integrates with Debian and derived package managers, and
   * `.AppImage` runs on any distro without installing anything.
   */
  readonly bundles: ReadonlyArray<string>;
  /** The GitHub Actions runner that builds it. */
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
