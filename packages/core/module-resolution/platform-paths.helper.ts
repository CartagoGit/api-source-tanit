/**
 * Platform path helpers (proposal `r00020` S1).
 *
 * The resolver has to understand three path dialects:
 *
 *   - POSIX — `/app/src/main.ts`
 *   - Windows with a drive letter — `C:\app\src\main.ts`
 *   - Windows UNC share — `\\server\share\pkg`
 *
 * The previous resolver was "posix-shaped": it only knew about `/`
 * and treated anything else (`C:\app\...`) as a relative specifier,
 * so a Windows absolute import resolved to nothing at all. These
 * helpers are the dialect-aware replacement.
 *
 * Everything here is pure: no filesystem access, no `node:path`. The
 * resolver has to reason about paths that do not exist on the machine
 * that is running the scan (a project recorded on a developer's
 * Windows laptop, scanned on a Linux CI box), so the dialect has to
 * be a property of the *string*, not of the host.
 *
 * The canonical form used while reasoning is POSIX (always `/`), and
 * the native form is restored on the way out.
 */
import type { PathStyle } from "../../contracts/interfaces/core/module-resolution.interface.js";

/** A path split into its root and the rest. */
interface IDriveSplit {
  /** `""`, `"C:"` or `"\\\\server\\share"` — never with a trailing separator. */
  readonly drive: string;
  /** Everything after the drive, in the original dialect. */
  readonly rest: string;
}

/** Matches a Windows drive letter at the start of a path: `C:` or `c:`. */
const DRIVE_RE = /^[A-Za-z]:(?=[\\/]|$)/;

/**
 * Which dialect a path is written in.
 *
 * The UNC check comes first: `\\server\share` starts with two
 * separators and would otherwise look like a plain POSIX absolute
 * path.
 */
export function detectPathStyle(path: string): PathStyle {
  if (path.startsWith("\\\\") || /^\/\/[^/]/.test(path)) return "unc";
  if (DRIVE_RE.test(path)) return "win32";
  return "posix";
}

/**
 * Whether the path is absolute in any dialect.
 *
 * `C:foo` (drive without a separator) is **not** absolute: on Windows
 * it is relative to the current directory of the drive.
 */
export function isAbsolutePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("/")) return true;
  if (path.startsWith("\\\\")) return true;
  if (DRIVE_RE.test(path)) return path.length > 2;
  return false;
}

/**
 * Split the root off a path.
 *
 * The drive keeps its native spelling (`C:`, `\\\\server\\share`) and
 * never carries a trailing separator.
 */
export function splitDrive(path: string): IDriveSplit {
  if (path.startsWith("\\\\") || /^\/\/[^/]/.test(path)) {
    const posix = path.replaceAll("\\", "/");
    const parts = posix.slice(2).split("/").filter((s) => s.length > 0);
    const server = parts[0];
    const share = parts[1];
    if (server !== undefined && share !== undefined) {
      const drive = `\\\\${server}\\${share}`;
      const rest = posix.slice(2 + server.length + 1 + share.length);
      return {
        drive,
        rest: rest.length > 0 ? `\\${rest.replaceAll("/", "\\")}` : "\\",
      };
    }
    return { drive: "", rest: path };
  }
  const driveMatch = DRIVE_RE.exec(path);
  if (driveMatch) {
    return { drive: driveMatch[0].slice(0, 2), rest: path.slice(2) };
  }
  return { drive: "", rest: path };
}

/**
 * Rewrite a path in POSIX spelling (always `/`).
 *
 * The UNC root keeps its double slash, so `\\\\server\\share\\x`
 * becomes `//server/share/x`.
 */
export function toPosixPath(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * Rewrite a path in the given dialect.
 *
 * `posix` keeps the `/` separators; `win32` and `unc` use `\`.
 */
export function toNativePath(path: string, style: PathStyle): string {
  if (style === "posix") return path;
  return path.replaceAll("/", "\\");
}

/**
 * Rebuild a path from its drive and a POSIX body.
 *
 * The body may start with `/` (absolute) or not (relative).
 */
function fromPosixParts(
  drive: string,
  body: string,
  style: PathStyle,
): string {
  const separator = style === "posix" ? "/" : "\\";
  const normalizedBody = body.replace(/^\/+/, "");
  const absolute = body.startsWith("/");
  if (drive.length > 0) {
    return `${drive}${separator}${normalizedBody}`;
  }
  return absolute ? `${separator}${normalizedBody}` : normalizedBody;
}

/**
 * Collapse `.` and `..` segments, keeping the root intact.
 *
 * `..` never escapes the root: `/a/../..` is `/`, and
 * `C:\a\..\..` is `C:\`.
 */
export function normalizePath(path: string): string {
  if (path.length === 0) return path;
  const style = detectPathStyle(path);
  const { drive, rest } = splitDrive(path);
  const posixRest = toPosixPath(rest);
  const absolute = posixRest.startsWith("/");
  const segments: string[] = [];
  for (const segment of posixRest.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      const last = segments[segments.length - 1];
      if (segments.length > 0 && last !== "..") {
        segments.pop();
        continue;
      }
      if (!absolute) segments.push("..");
      continue;
    }
    segments.push(segment);
  }
  const body = `${absolute ? "/" : ""}${segments.join("/")}`;
  return fromPosixParts(drive, body, style);
}

/**
 * Join a relative path onto a base path.
 *
 * An absolute `rel` wins outright — that is how a specifier like
 * `C:\app\x.ts` behaves when it is joined against a POSIX base.
 */
export function joinPath(base: string, rel: string): string {
  if (rel.length === 0) return normalizePath(base);
  if (isAbsolutePath(rel)) return normalizePath(rel);
  const style = detectPathStyle(base);
  const { drive, rest } = splitDrive(base);
  const posixRest = toPosixPath(rest);
  const posixRel = toPosixPath(rel);
  const joined = posixRest.endsWith("/")
    ? `${posixRest}${posixRel}`
    : `${posixRest}/${posixRel}`;
  const absolute = posixRest.startsWith("/");
  return fromPosixParts(drive, `${absolute ? "/" : ""}${joined.replace(/^\/+/, "")}`, style);
}

/** The directory that contains the path. */
export function dirnamePath(path: string): string {
  const style = detectPathStyle(path);
  const { drive, rest } = splitDrive(path);
  const posixRest = toPosixPath(rest);
  const index = posixRest.lastIndexOf("/");
  if (index === -1) {
    return drive.length > 0 ? drive : ".";
  }
  if (index === 0) {
    return fromPosixParts(drive, "/", style);
  }
  return fromPosixParts(drive, posixRest.slice(0, index), style);
}

/** The last segment of the path, without the directories. */
export function basenamePath(path: string): string {
  const posix = toPosixPath(path);
  const index = posix.lastIndexOf("/");
  return index === -1 ? posix : posix.slice(index + 1);
}

/**
 * The extension of the path, including the dot — `""` when there is
 * none.
 *
 * A dotfile (`.eslintrc`) has no extension: the dot is the name.
 */
export function extnamePath(path: string): string {
  const name = basenamePath(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot);
}

/** The path without its extension. */
export function stripExtension(path: string): string {
  const extension = extnamePath(path);
  if (extension.length === 0) return path;
  return path.slice(0, path.length - extension.length);
}

/**
 * Replace the drive of a path with a local directory.
 *
 * `C:\app\src\main.ts` with `{"C:": "/home/dev/app"}` becomes
 * `/home/dev/app/src/main.ts`.
 *
 * A drive that is not mapped falls back to `fallbackRoot` — the
 * project root, for the resolver. A scanner that meets an absolute
 * path written in another dialect is looking at a path **inside** the
 * project it is scanning, and the project root is the only root it
 * can probe. A caller that knows the real drive root says so, and
 * the mapping wins.
 *
 * @param path        The path to remap.
 * @param driveRoots  The explicit mappings, by drive or by share.
 * @param fallbackRoot The root used when the drive is not mapped.
 */
export function applyDriveRoot(
  path: string,
  driveRoots: Readonly<Record<string, string>>,
  fallbackRoot?: string,
): string {
  const { drive, rest } = splitDrive(path);
  if (drive.length === 0) return path;
  const root = driveRoots[drive] ?? fallbackRoot;
  if (root === undefined) return path;
  const normalizedRoot = root.replace(/[/\\]+$/, "");
  const suffix = toPosixPath(rest).replace(/^\/+/, "");
  return suffix.length > 0
    ? `${normalizedRoot}/${suffix}`
    : normalizedRoot;
}
