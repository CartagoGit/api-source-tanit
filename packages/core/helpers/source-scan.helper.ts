/**
 * Source-code scanning primitives shared by the scanners.
 *
 * All scanners that read code (Express, Next.js, NestJS…) need the
 * same three operations on plain text:
 *
 *   1. Strip comments before applying regex, so a commented-out
 *      endpoint does not appear in the collection.
 *   2. Locate a `foo(` call and find its closing `)` respecting
 *      nesting (`findAllBalanced`, `findNearestBalanced`).
 *   3. Split the inside of an object literal by top-level commas
 *      without breaking strings or nested objects (`splitTopLevel`).
 *
 * They used to live duplicated in `express.scanner.ts` and
 * `nextjs.scanner.ts`. The Next.js copy iterated with `regex.exec()`
 * over a regex **without the `g` flag**, so `lastIndex` never advanced
 * and the loop never terminated. Centralizing them here removes the
 * bug and the divergence.
 */
import type { IBalancedCall } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * Strips block and line comments from a JS/TS source.
 *
 * The `//` is dropped only if it is not preceded by `:`, to avoid
 * breaking URLs (`https://…`) that appear in string literals.
 */
export function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Finds the `)` that closes the `(` located at `openIndex`, respecting
 * nesting. Returns `-1` if the parenthesis is never closed.
 */
export function findClosingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * All occurrences of `pattern` in `text`, each with the balanced
 * position of its call.
 *
 * `pattern` must describe the prefix of a call (e.g.
 * `/z\.object\s*\(/`); the `(` is searched from the start of the match.
 * The regex is always re-created with the `g` flag, so it does not
 * matter how the caller declared it.
 */
export function findAllBalanced(text: string, pattern: RegExp): IBalancedCall[] {
  const out: IBalancedCall[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  // The **start** of the call is searched on the mask: this way one
  // written inside a text —`'usa app.get("/x")'`— does not count as a
  // call. The indices are valid on the original because the mask
  // preserves length, and the content is still read from `text`, where
  // the arguments are the real ones.
  //
  // It affected Hono, Fastify, and the zod and Joi parsers: any example
  // in a string comment or in a help text produced an endpoint that
  // exists nowhere.
  const masked = maskStringLiterals(text);
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    // A regex that can match empty would hang the loop: force advance.
    if (m[0].length === 0) re.lastIndex++;
    const callStart = masked.indexOf("(", m.index);
    if (callStart === -1) continue;
    // The closing parenthesis is searched in the ORIGINAL: a `)` inside
    // a string does not close anything, and on the mask that character
    // is no longer there.
    const callEnd = findClosingParen(text, callStart);
    if (callEnd === -1) continue;
    out.push({ callStart, callEnd });
  }
  return out;
}

/**
 * Of all calls that match `pattern`, the closest (by line count) to
 * `nearLine`. Used to associate a schema with the handler that uses it
 * when a single file declares several.
 */
export function findNearestBalanced(
  text: string,
  pattern: RegExp,
  nearLine: number,
): IBalancedCall | null {
  let best: IBalancedCall | null = null;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const call of findAllBalanced(text, pattern)) {
    const lineOfMatch = countLinesBefore(text, call.callStart);
    const distance = Math.abs(lineOfMatch - nearLine);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = call;
    }
  }
  return best;
}

/** 0-based line index of the character at `index`. */
export function countLinesBefore(text: string, index: number): number {
  let lines = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") lines++;
  }
  return lines;
}

/**
 * Splits the inside of an object literal by top-level commas.
 *
 * Ignores commas inside strings (`'`, `"`, backtick, with escapes) and
 * inside nested `()`, `{}` or `[]`. The depth starts at 1 because the
 * received text includes the outer braces of the object.
 */
export function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  // The depth at which a comma separates two items at the SAME level.
  //
  // Depends on whether the caller includes the outer braces or not.
  // Before it was fixed at 1, meaning it only worked when passing them
  // — without saying so anywhere. Passing the bare body returned **a
  // single item** with everything inside, in silence: the Hono scanner
  // spent a while like that, extracting one field out of four.
  const trimmed = body.trim();
  const wrapped =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  const separatorDepth = wrapped ? 1 : 0;

  let depth = 0;
  let inString: string | null = null;
  let buffer = "";

  for (let i = 0; i < body.length; i++) {
    const c = body[i];

    if (inString) {
      buffer += c;
      if (c === "\\") {
        buffer += body[i + 1] ?? "";
        i++;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }

    if (c === "'" || c === '"' || c === "`") {
      inString = c;
      buffer += c;
      continue;
    }

    if (c === "(" || c === "{" || c === "[") {
      depth++;
      buffer += c;
      continue;
    }

    if (c === ")" || c === "}" || c === "]") {
      depth--;
      buffer += c;
      continue;
    }

    if (c === "," && depth === separatorDepth) {
      out.push(buffer.trim());
      buffer = "";
      continue;
    }

    buffer += c;
  }

  if (buffer.trim()) out.push(buffer.trim());
  return out;
}

/**
 * Removes the outer braces and trailing whitespace from an item
 * returned by `splitTopLevel` (the first drags the `{`, the last the `}`).
 */
export function unwrapObjectLiteralItem(item: string): string {
  return item
    .replace(/^\s*\{\s*/, "")
    .replace(/\s*\}\s*$/, "")
    .trim();
}

/**
 * Replaces the **contents** of strings with spaces, keeping the quotes
 * and the total length.
 *
 * Used to answer a question the scanners ask all the time without
 * knowing it: *is this call actually in the code, or is it inside a
 * string?* A file with
 *
 *     const help = 'use router.get("/x") to register';
 *
 * produced a `GET /x` endpoint that does not exist. The text of a
 * string is not code, but for a regex it reads the same.
 *
 * Length is preserved on purpose: this way the offsets on the mask are
 * valid on the original source, and we can search on the mask and read
 * from the original. Without that we'd need to maintain a position
 * map, which is the kind of thing that desyncs.
 *
 * Covers single quotes, double quotes, and templates. Inside a
 * template, what goes in `${…}` **is** code and is preserved: that is
 * where the interpolations live that other lints need to see.
 */
export function maskStringLiterals(src: string): string {
  const out = src.split("");
  let i = 0;

  while (i < src.length) {
    const char = src[i];
    if (char !== '"' && char !== "'" && char !== "`") {
      i++;
      continue;
    }
    const quote = char;
    let j = i + 1;
    let depth = 0;
    while (j < src.length) {
      const c = src[j];
      if (c === "\\") {
        // An escape takes the next character along with it, whatever it
        // is: without this, a `"\\""` would close where it should not.
        out[j] = " ";
        if (j + 1 < src.length) out[j + 1] = " ";
        j += 2;
        continue;
      }
      // `${` inside a template opens real code.
      if (quote === "`" && c === "$" && src[j + 1] === "{") {
        depth++;
        j += 2;
        continue;
      }
      if (depth > 0) {
        if (c === "}") depth--;
        j++;
        continue;
      }
      if (c === quote) break;
      // A newline closes a single- or double-quoted string: if it's
      // still open, it was not a string, and masking until the end of
      // the file would eat the rest of the code.
      if (c === "\n" && quote !== "`") break;
      out[j] = " ";
      j++;
    }
    i = j + 1;
  }
  return out.join("");
}

/**
 * The occurrences of `pattern` that are **outside** any string.
 *
 * The trick has two halves and both are needed:
 *
 *   1. We **search** on the mask, where the contents of the strings
 *      are spaces. So a call written inside a text —
 *      `'use router.get("/x")'`— does not appear.
 *   2. We **read** from the original source, at the same position. The
 *      mask preserves length exactly for this: the path of a real
 *      route IS a string, so on the mask it comes out blank and
 *      reading it from there would give empty paths.
 *
 * Skipping the second half is easy and the failure is silent: the
 * captured groups come out full of spaces and the paths are discarded
 * one by one without anything saying so.
 */
export function findOutsideStrings(
  src: string,
  pattern: RegExp,
): Array<{ index: number; match: RegExpExecArray }> {
  const clean = stripJsComments(src);
  const masked = maskStringLiterals(clean);
  // Own copies: moving the `lastIndex` of the regex we were passed
  // would break the loop of whoever called us (see `lint:regex-state`).
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const finder = new RegExp(pattern.source, flags);
  // `y` (sticky) anchors the read exactly where the mask found the
  // call, without searching again.
  const reader = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}y`);

  const out: Array<{ index: number; match: RegExpExecArray }> = [];
  let m: RegExpExecArray | null;
  while ((m = finder.exec(masked)) !== null) {
    if (m[0].length === 0) {
      finder.lastIndex++;
      continue;
    }
    reader.lastIndex = m.index;
    const real = reader.exec(clean);
    if (real) out.push({ index: m.index, match: real });
  }
  return out;
}
