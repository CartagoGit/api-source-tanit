#!/usr/bin/env bun
/**
 * Reading static files — and the token that goes with them.
 *
 * Two faces of the same product need this: the web interface the CLI
 * serves (`packages/ui/server/ui-server.service.ts`) and the desktop
 * app in the browser (`packages/app`, Angular). They used to have one
 * copy each, and the copies were already different in the part that
 * matters — where the token goes.
 *
 * ## The token, and why it is in the page
 *
 * The server binds to `127.0.0.1`, which is **not** the same as being
 * unreachable: the browser of whoever is running it can reach it, and
 * so can any page that person visits while the interface is up. A
 * cross-origin `POST` with `content-type: text/plain` needs no
 * preflight, so without a token any such page could drive the
 * interface — and the interface writes files.
 *
 * The token closes that. It has to reach the page that is allowed to
 * talk, and it has to reach it in a way a third party cannot read.
 *
 *   · A **cookie** is sent by the browser on its own, to any request
 *     to this origin — including the ones another site fires. So a
 *     cookie is not the place for it.
 *   · An **attribute in the served HTML** is only read by whoever can
 *     read the HTML, and same-origin policy is exactly what stops a
 *     third party from doing that.
 *
 * So the token travels in the HTML, and the page reads it from there.
 * Where it sits inside the HTML depends on the page: the embedded
 * interface reads it off its own `<script>`, and the Angular app off
 * the `<html>` element (`document.documentElement.dataset`).
 *
 * ## Why it returns data and not a response
 *
 * The two servers have different content-security policies, and each
 * one owns its own. So this reads a file and says what it is; the
 * caller builds the response it wants.
 */
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { IAsset, TokenTarget } from "../../contracts/interfaces/core/static-asset.interface.js";

/** Content type by file extension, for the handful we serve. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/**
 * Reads one file from `directory`.
 *
 * Returns `null` when the file does not exist, so the caller can fall
 * back to its own routing — a single-page app asks for paths that are
 * not files.
 *
 * A path that tries to escape the directory is refused. The server
 * binds to loopback, but the browser is the one asking, and a path
 * that climbs out of the served folder would turn the interface into
 * an arbitrary file reader.
 */
export async function readAsset(
  directory: string,
  pathname: string,
): Promise<IAsset | null> {
  const root = resolve(directory);
  const relative = pathname === "/" || pathname === "/index.html" ? "index.html" : pathname.slice(1);
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${sep}`)) return null;
  try {
    if (!(await stat(file)).isFile()) return null;
    const contents = await readFile(file, "utf8");
    const extension = file.slice(file.lastIndexOf("."));
    return {
      contents,
      type: CONTENT_TYPES[extension] ?? "application/octet-stream",
      isPage: file.endsWith("index.html"),
    };
  } catch {
    return null;
  }
}

/**
 * Plants the token in the HTML.
 *
 * The `<html>` element is the target for the Angular app: its
 * `document.documentElement.dataset` is the first thing that exists
 * and the last thing to go, so the token is there before the app boots
 * and while it runs.
 */
export function plantToken(html: string, token: string, target: TokenTarget = "html"): string {
  if (target === "script") {
    return html.replace(/<script(\s[^>]*)?>/, (tag) => {
      const attributes = tag.slice("<script".length, -1).trim();
      return `<script${attributes ? ` ${attributes}` : ""} data-token="${token}">`;
    });
  }
  return html.replace(/<html(\s[^>]*)?>/, (tag) => {
    const attributes = tag.slice("<html".length, -1).trim();
    return `<html${attributes ? ` ${attributes}` : ""} data-tanit-token="${token}">`;
  });
}
