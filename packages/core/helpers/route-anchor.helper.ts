/**
 * Route anchoring — finding the declaration of a route inside a file.
 *
 * ## Why this exists
 *
 * A response inferrer reads a file and has to answer "which part of
 * this file belongs to the route I was given?". The answer is not
 * trivial:
 *
 * - The scanner may have applied prefixes, so the URI the inferrer
 *   receives (`/api/users`) is **not** what the code says (`/users`).
 * - The method may be spelled four different ways (`get`, `GET`,
 *   `Get`, `verb`).
 * - A file may declare ten routes, and the wrong one produces a
 *   confidently wrong answer.
 *
 * So every inferrer needs the same three steps: find the candidate
 * declarations, recognise which one is *this* route, and hand back the
 * region of the file that belongs to it.
 *
 * ## What is here and what is not
 *
 * The **matching** is here — it is dialect-free. The **declaration
 * pattern** is not: each framework spells its routes differently
 * (`app.get("/x")`, `r.GET("/x")`, `get("/x") { }`,
 * `Route::get('/x', …)`), so each inferrer passes its own pattern.
 * That is the whole point of the slice: the *shape* of a route
 * declaration is framework-specific, the *arithmetic* of finding it
 * is not.
 */
import type {
  IResponseRoute,
  IRouteAnchor,
} from "../../contracts/interfaces/core/response-inferrer.interface.js";

export type { IRouteAnchor };

/**
 * Collects the route declarations of a file.
 *
 * `pattern` must expose **two** capture groups: the method and the
 * path. It is re-created with the `g` flag so the caller never has to
 * think about `lastIndex` state — a module-level regex with the `g`
 * flag is the classic source of "the second call finds nothing".
 */
export function findRouteAnchors(
  text: string,
  pattern: RegExp,
): ReadonlyArray<IRouteAnchor> {
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  const anchors: IRouteAnchor[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) re.lastIndex++;
    const method = (match[1] ?? "").toUpperCase();
    const path = match[2] ?? "";
    if (method.length === 0 || path.length === 0) continue;
    anchors.push({
      index: match.index,
      end: match.index + match[0].length,
      line: countLines(text, match.index),
      method,
      path,
    });
  }
  return anchors;
}

/**
 * Picks the declaration that corresponds to `route`.
 *
 * The search is ordered by how strong the evidence is:
 *
 * 1. The path is **exactly** the raw URI (what the code declares).
 * 2. The path is exactly the full URI (no prefixes involved).
 * 3. The full URI **ends with** the declared path — the prefix case,
 *    `/api/users` vs `/users`.
 * 4. The last segment of the URI is the declared path.
 *
 * Among the candidates that survive, the one **closest to the route's
 * line** wins: when a file declares the same path twice (two routers,
 * a re-mount), the declaration near the route's line is the one the
 * scanner saw.
 *
 * Returns `null` when the file declares nothing that could be this
 * route — the inferrer then has nothing to read, and says so.
 */
export function pickRouteAnchor(
  anchors: ReadonlyArray<IRouteAnchor>,
  route: IResponseRoute,
): IRouteAnchor | null {
  if (anchors.length === 0) return null;

  const wanted = route.rawUri ?? route.uri;
  const byPath =
    pickBy(anchors, (a) => a.path === wanted) ??
    pickBy(anchors, (a) => a.path === route.uri) ??
    pickBy(anchors, (a) => route.uri.endsWith(a.path)) ??
    pickBy(anchors, (a) => lastSegment(route.uri) === lastSegment(a.path)) ??
    [];

  if (byPath.length === 0) return null;

  // The method breaks the tie. A file may declare `GET /users` and
  // `POST /users` — two routes, one path — and reading the wrong one
  // produces a confidently wrong answer. The path alone is the
  // fallback for the frameworks that spell the verb in a way the
  // pattern does not capture (`app.all(…)`).
  const method = route.method.toUpperCase();
  const byMethod = byPath.filter((a) => a.method === method);
  const candidates = byMethod.length > 0 ? byMethod : byPath;
  if (candidates.length === 1) return candidates[0] ?? null;
  return closestToLine(candidates, route.lineNumber);
}

/**
 * The text that belongs to a declaration: from the end of the
 * declaration up to the **next** declaration, bounded.
 *
 * This is the window every inferrer actually wants. It holds the
 * options object, the handler, and nothing else — stopping at the
 * next route is what keeps one route from reading the next route's
 * response call.
 */
export function sliceUntilNextAnchor(
  text: string,
  anchor: IRouteAnchor,
  anchors: ReadonlyArray<IRouteAnchor>,
  maxChars = 2000,
): string {
  const next = anchors.find((a) => a.index > anchor.index);
  const limit = next === undefined ? anchor.end + maxChars : next.index;
  return text.slice(anchor.end, Math.min(limit, anchor.end + maxChars));
}

/**
 * The region of the file that belongs to `route`, or `null` when the
 * file declares no such route.
 *
 * The three steps every inferrer needs — find the declarations,
 * recognise which one is *this* route, hand back its region — in one
 * call. An inferrer that needs the region twice (once to answer
 * `detect()`, once to answer `infer()`) reads the same bytes twice;
 * one that needs it once does not care.
 */
export function routeRegionOf(
  text: string,
  pattern: RegExp,
  route: IResponseRoute,
): string | null {
  const anchors = findRouteAnchors(text, pattern);
  const anchor = pickRouteAnchor(anchors, route);
  if (anchor === null) return null;
  return sliceUntilNextAnchor(text, anchor, anchors);
}

/** Number of newlines before `index` — the 0-based line of a match. */
function countLines(text: string, index: number): number {
  let lines = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") lines++;
  }
  return lines;
}

/** The anchors that satisfy a predicate, or `null` when there are none. */
function pickBy(
  anchors: ReadonlyArray<IRouteAnchor>,
  predicate: (anchor: IRouteAnchor) => boolean,
): ReadonlyArray<IRouteAnchor> | null {
  const found = anchors.filter(predicate);
  return found.length > 0 ? found : null;
}

/** The candidate whose line is closest to the route's line. */
function closestToLine(
  candidates: ReadonlyArray<IRouteAnchor>,
  lineNumber: number | undefined,
): IRouteAnchor | null {
  if (lineNumber === undefined || lineNumber <= 0) {
    return candidates[0] ?? null;
  }
  let best: IRouteAnchor | null = null;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const candidate of candidates) {
    // The route's line is 1-based; the anchor's is 0-based.
    const distance = Math.abs(candidate.line + 1 - lineNumber);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** The last non-empty segment of a path. */
function lastSegment(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? "";
}
