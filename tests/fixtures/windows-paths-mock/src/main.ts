/**
 * Entry point of the `windows-paths-mock` fixture.
 *
 * The imports below are **absolute Windows paths**: the way a project
 * recorded on a Windows machine writes them. The previous resolver
 * was posix-shaped and treated both of them as a relative specifier,
 * so they resolved to nothing at all.
 *
 *   - `C:\src\helper` — a drive letter.
 *   - `\\server\share\src\helper` — a UNC share.
 *
 * The resolver maps the drive (and the share) onto the directory of
 * the fixture, which is what "the same project, checked out
 * somewhere else" means.
 */
import { helper } from "C:\\src\\helper";
import { sharedHelper } from "\\\\server\\share\\src\\helper";

export const main = {
  helper,
  sharedHelper,
};
