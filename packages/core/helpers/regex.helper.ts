/**
 * Shared regexes used without stepping on each other.
 *
 * A regex with the `g` flag stores its position in `lastIndex`. If it
 * lives at module scope — which is the norm, to avoid recompiling it
 * on every call — that position is shared by **everyone using it**.
 *
 * `lint:regex-state` already forbade assigning an arbitrary position
 * to it, because that hangs the loop of whoever called it. But it
 * allowed `RE.lastIndex = 0`, which seemed harmless: it leaves the
 * state at a known point instead of inheriting it.
 *
 * It is not, as soon as there are two analyses at once. The loop
 *
 *     RE.lastIndex = 0;
 *     while ((m = RE.exec(line)) !== null) { await algo(); }
 *
 * yields at every `await`. If another execution gets in and does its
 * own `RE.lastIndex = 0`, the first loop jumps back to the start of the
 * line and repeats paths.
 *
 * Measured on the Django fixture: two concurrent `generateCollection`
 * over the **same** project returned 19 and 18 paths. The extra one
 * later got merged by method + URI, so the collection came out right
 * and only the counter lied — and a warning said the endpoint was
 * "declared by more than one framework" when there was only one.
 *
 * Until now nobody saw it because the pipeline serialized the calls
 * with a global queue. After removing it (r00005 S2), it became
 * visible.
 *
 * ## What to use
 *
 * - To walk all matches: `text.matchAll(RE)`. It does not touch the
 *   `lastIndex` of the original — it takes its own copy — so it is
 *   safe without help from anyone.
 * - For a single `exec` with groups: `ownRegex(RE)`, which is what
 *   `matchAll` does internally.
 */

/**
 * An own copy of a shared regex.
 *
 * It starts with `lastIndex` at zero and nobody else touches it, so it
 * can be used with `exec` without coordinating with the rest of the
 * process.
 */
export function ownRegex(shared: RegExp): RegExp {
  return new RegExp(shared.source, shared.flags);
}
