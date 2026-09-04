/**
 * Does this path escape where it's supposed to write?
 *
 * `--output-dir` and `POSTMAN_OUTPUT_DIR` were accepted as-is, without
 * any check. On a CLI that a person runs on their own machine that is
 * reasonable: if someone writes `--output-dir /tmp/x`, it is because
 * they want to write there.
 *
 * But the MCP plugin **spawns this same CLI** with arguments coming
 * from an agent, and there whoever picks the path is no longer
 * necessarily the person. A path with `../` writes outside the
 * project.
 *
 * Two details that make this actually work:
 *
 *   1. **Symlinks are resolved before comparing.** Without that, a link
 *      inside the root pointing outside passes the check and writes
 *      wherever it pleases.
 *   2. **Comparison is by segments, not by string prefix.**
 *      `/a/bad-root` starts with `/a/root` and is not inside it. It is
 *      the classic failure of this check.
 */
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ContainmentResult } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * The nearest existing ancestor.
 *
 * Needed because the output path **normally does not exist yet** — it
 * will be created — and `realpath` on something that doesn't exist
 * fails. Walk up until something real is found, resolve the links
 * there, and walk back down. This way a link in the middle of the path
 * cannot escape either.
 */
async function realpathOfNearestExisting(target: string): Promise<string> {
  let current = resolve(target);
  const pending: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return pending.length > 0 ? resolve(real, ...pending.reverse()) : real;
    } catch {
      const parent = resolve(current, "..");
      // Got to the system root without finding anything existing.
      if (parent === current) return resolve(target);
      pending.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

/**
 * Is `target` inside `root`?
 *
 * The root itself counts as inside. Returns the already-resolved path
 * so the caller uses that and not the original: checking one and
 * writing in another is how these checks get bypassed.
 */
export async function ensureInside(
  root: string,
  target: string,
): Promise<ContainmentResult> {
  return ensureInsideAny([root], target);
}

/**
 * Is `target` inside **any** of the roots?
 *
 * Several, not just one, because a single one does not describe the
 * legitimate use. An agent may ask "generate for project X and leave
 * the output in my working folder", and those are two distinct and
 * both reasonable locations. With a single root that was rejected, and
 * a guard that blocks normal use eventually gets removed.
 *
 * What does stay out is the rest of the disk: the output goes with the
 * project, inside the workspace, or in a temp dir — not to anyone's
 * `$HOME` because a `../` slipped into an argument.
 */
export async function ensureInsideAny(
  roots: ReadonlyArray<string>,
  target: string,
): Promise<ContainmentResult> {
  const first = roots[0] ?? ".";
  const realTarget = await realpathOfNearestExisting(
    isAbsolute(target) ? target : resolve(first, target),
  );

  const resolvedRoots: string[] = [];
  for (const root of roots) {
    const realRoot = await realpathOfNearestExisting(root);
    resolvedRoots.push(realRoot);
    const rel = relative(realRoot, realTarget);
    // Empty = it is the root itself. With `..` at the start, or absolute, it escapes.
    const inside =
      rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
    if (inside) return { ok: true, resolved: realTarget };
  }

  return {
    ok: false,
    resolved: realTarget,
    reason: `'${realTarget}' is outside ${resolvedRoots.map((r) => `'${r}'`).join(", ")}`,
  };
}
