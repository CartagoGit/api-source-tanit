/**
 * `TrpcScanner` — tRPC routers.
 *
 * tRPC looks like it has no routes because from the client side it is
 * called as if they were functions. But underneath **it is HTTP**, and
 * with fixed rules:
 *
 *   - A `query` is a `GET /trpc/<procedure.path>` with the input in
 *     `?input=<json>`.
 *   - A `mutation` is a `POST /trpc/<path>` with the input in the body.
 *
 * So a collection that **works** can be generated — which is exactly
 * what cannot be done by hand without memorising these rules. That is
 * the most valuable part of this scanner: tRPC is the protocol that
 * the most people use without knowing which URL they are calling.
 *
 * The procedure name comes from nesting the routers:
 * `appRouter → users → list` is `users.list`.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";
import { collectFilesFrom, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { findClosingParen, stripJsComments } from "../../core/helpers/source-scan.helper.js";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";
import type { ITrpcProcedure } from "../../contracts/interfaces/frameworks/scanners.interface.js";

/** The prefix tRPC is almost always mounted at. */
const DEFAULT_PREFIX = "/trpc";

const TRPC_PACKAGES = ["@trpc/server", "@trpc/client", "@trpc/next"];

/**
 * Lockfiles present in `projectRoot` as bonus runtime signals.
 *
 * f00011 S4: `pnpm-lock.yaml` and Bun lockfiles refine the detector's
 * confidence without being detection. Small weights: +0.1 (pnpm),
 * +0.15 (bun). The tRPC detector almost always reaches 0.95 from
 * the dependency; the bonus shows up in `evidence` even though it
 * doesn't change the visible score — exactly what we want:
 * traceability, not detection.
 *
 * x00035 S1: Bun ≥ 1.2 emits `bun.lock` (text) and Bun < 1.2 emits
 * `bun.lockb` (binary). Both are accepted; if both are present
 * (degenerate case, modern project with a stale binary lock), the
 * modern `bun.lock` wins and `bun.lockb` is ignored.
 */
function lockfileSignals(projectRoot: string): Array<{ signal: string; weight: number; artifact: string }> {
  const out: Array<{ signal: string; weight: number; artifact: string }> = [];
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) {
    out.push({ signal: "pnpm-lock.yaml presente", weight: 0.1, artifact: "pnpm-lock.yaml" });
  }
  if (existsSync(join(projectRoot, "bun.lock"))) {
    out.push({ signal: "bun.lock presente", weight: 0.15, artifact: "bun.lock" });
  } else if (existsSync(join(projectRoot, "bun.lockb"))) {
    out.push({ signal: "bun.lockb presente", weight: 0.15, artifact: "bun.lockb" });
  }
  return out;
}

export class TrpcProjectScanner implements IProjectScanner {
  readonly framework = "trpc" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const pkgPath = join(projectRoot, "package.json");
    if (!existsSync(pkgPath)) return emptyResult(0);
    const parsed = parseJson(await readFile(pkgPath, "utf8"));
    if (!parsed.ok || !isRecord(parsed.value)) return emptyResult(0);
    const deps = {
      ...((parsed.value["dependencies"] as Record<string, string>) ?? {}),
      ...((parsed.value["devDependencies"] as Record<string, string>) ?? {}),
    };
    const matched = TRPC_PACKAGES.filter((name) => deps[name]);
    if (matched.length === 0) return emptyResult(0);
    const evidence = matched.map((name) => ({
      signal: `package.json declara ${name}`,
      weight: 0.95 / matched.length,
      artifact: "package.json",
    }));
    // f00011 S4: lockfile as runtime bonus. Added at the end so it
    // can't mask a missing framework.
    const locks = lockfileSignals(projectRoot);
    evidence.push(...locks);
    const lockBonus = locks.reduce((a, e) => a + e.weight, 0);
    return withEvidence(0.95 + lockBonus, evidence);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    return { framework: "trpc", projectRoot, artifacts: ["package.json"] };
  }
}

/** `router({ … })` y `t.router({ … })`. */
const ROUTER_RE = /(?:^|[\s=({,])(?:t\s*\.\s*)?router\s*\(/g;

/** `const usersRouter = t.router(` → name and position of the parenthesis. */
const NAMED_ROUTER_RE =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:t\s*\.\s*)?router\s*\(/g;

/** Index of the routers declared with a name in a source. */
export function findNamedRouters(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const own = new RegExp(NAMED_ROUTER_RE.source, NAMED_ROUTER_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = own.exec(source)) !== null) {
    const name = match[1];
    if (name) out.set(name, match.index + match[0].length - 1);
  }
  return out;
}

/**
 * Router names that appear **as a value** inside another one.
 *
 * It's what separates a root from a branch: `users: usersRouter`
 * makes `usersRouter` a branch, and whatever doesn't appear anywhere
 * is the root of the tree.
 */
export function referencedRouterNames(
  source: string,
  namedRouters: ReadonlyMap<string, number>,
): Set<string> {
  const out = new Set<string>();
  for (const match of source.matchAll(/(\w+)\s*:\s*([A-Za-z_$][\w$]*)\s*(?:,|\})/g)) {
    const value = match[2];
    if (value && namedRouters.has(value)) out.add(value);
  }
  return out;
}

/**
 * Reads a `router({ … })` and returns its procedures, descending into
 * nested routers.
 *
 * We walk character by character instead of using a regex because the
 * structure is recursive: a router contains routers, and a flat pattern
 * cannot distinguish that.
 */
export function parseRouterObject(
  source: string,
  from = 0,
  prefix = "",
  /**
   * Routers declared separately, by name.
   *
   * Almost nobody writes the whole tree in one expression: the usual
   * shape is `const usersRouter = t.router({…})` and then
   * `t.router({ users: usersRouter })`. Without resolving that
   * indirection, procedures come out **without their prefix** —
   * `list` instead of `users.list` — and the `list` of one router
   * collides with the other's, because from the outside they look the
   * same.
   */
  namedRouters: ReadonlyMap<string, number> = new Map(),
  /** Names already visited, so a circular reference doesn't hang. */
  visiting: ReadonlySet<string> = new Set(),
): ITrpcProcedure[] {
  const open = source.indexOf("{", from);
  if (open === -1) return [];
  const close = matchingBrace(source, open);
  if (close === -1) return [];

  const out: ITrpcProcedure[] = [];
  const body = source.slice(open + 1, close);

  // Each object key is a procedure or a nested router.
  const keyRe = /(\w+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = keyRe.exec(body)) !== null) {
    const key = match[1] ?? "";
    // Only top-level keys: those inside are seen by the recursive
    // call with its own prefix.
    if (depthAt(body, match.index) !== 0) continue;

    const rest = body.slice(match.index + match[0].length);
    const full = prefix ? `${prefix}.${key}` : key;

    // Router inlined: `users: t.router({ … })`.
    const nested = /^\s*(?:t\s*\.\s*)?router\s*\(/.exec(rest);
    if (nested) {
      out.push(...parseRouterObject(rest, nested[0].length - 1, full, namedRouters, visiting));
      continue;
    }

    // Router by reference: `users: usersRouter`.
    const reference = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|\}|$)/.exec(rest)?.[1];
    if (reference && namedRouters.has(reference) && !visiting.has(reference)) {
      out.push(
        ...parseRouterObject(
          source,
          namedRouters.get(reference)!,
          full,
          namedRouters,
          new Set([...visiting, reference]),
        ),
      );
      continue;
    }

    // `.query(...)`, `.mutation(...)`, `.subscription(...)` — the
    // first one to appear before the next top-level key.
    const kind = /\.\s*(query|mutation|subscription)\s*\(/.exec(
      rest.slice(0, nextTopLevelKey(rest)),
    )?.[1];
    if (kind === "query" || kind === "mutation" || kind === "subscription") {
      out.push({ path: full, kind });
    }
  }
  return out;
}

/** The `}` that closes the `{` at `open`. */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Depth of braces and parens at a position. */
function depthAt(text: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    const c = text[i];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
  }
  return depth;
}

/** Where the next top-level key starts, or the end. */
function nextTopLevelKey(text: string): number {
  const re = /(\w+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (depthAt(text, match.index) === 0 && match.index > 0) return match.index;
  }
  return text.length;
}

export class TrpcRouteScanner implements IRouteScanner {
  readonly framework = "trpc" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "trpc";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const files = await collectFilesFrom(
      ["src", "server", "app", ""].map((d) => (d ? join(effectiveProjectRoot(match), d) : effectiveProjectRoot(match))),
      isSourceJsTsFile,
    );

    const routes: ParsedRoute[] = [];
    const seen = new Set<string>();

    for await (const { path, text: raw } of readFilesInOrder(files)) {
      if (!/@trpc\/server|\brouter\s*\(/.test(raw)) continue;
      const source = stripJsComments(raw);
      const sourceFile = relative(rawProjectRoot(match), path);

      const namedRouters = findNamedRouters(source);
      // A root isn't "the router without a name" — `appRouter` also has
      // one. It's the one **nobody references**: `usersRouter` appears
      // inside `appRouter`, and `appRouter` doesn't appear inside anyone.
      //
      // Entering through the referenced ones too would emit each
      // procedure twice: once with its prefix (`users.list`) and once
      // without it (`list`), and the second is a route that doesn't
      // exist.
      const referenced = referencedRouterNames(source, namedRouters);
      const skip = new Set(
        [...namedRouters].filter(([name]) => referenced.has(name)).map(([, at]) => at),
      );
      const own = new RegExp(ROUTER_RE.source, ROUTER_RE.flags);
      let match2: RegExpExecArray | null;
      while ((match2 = own.exec(source)) !== null) {
        const parenAt = source.indexOf("(", match2.index);
        if (parenAt === -1) continue;
        if (skip.has(parenAt)) continue;
        if (findClosingParen(source, parenAt) === -1) continue;

        for (const proc of parseRouterObject(source, parenAt, "", namedRouters)) {
          if (seen.has(proc.path)) continue;
          seen.add(proc.path);

          // Subscriptions go over WebSocket: an HTTP request to the endpoint
          // doesn't work, and emitting it would deliver something that
          // fails on the first Send.
          if (proc.kind === "subscription") continue;

          const isQuery = proc.kind === "query";
          routes.push({
            // The tRPC rule over HTTP: query → GET, mutation → POST.
            method: isQuery ? "GET" : "POST",
            uri: `${DEFAULT_PREFIX}/${proc.path}`,
            rawUri: `${DEFAULT_PREFIX}/${proc.path}`,
            sourceFile,
            lineNumber: 1,
            prefixChain: [DEFAULT_PREFIX],
            displayName: proc.path,
            description: `${proc.kind} \`${proc.path}\``,
            tags: [isQuery ? "Queries" : "Mutations"],
            // The input travels differently depending on the type: in
            // the query it goes as `?input=<json>` and in the mutation
            // as a body. We leave the envelope empty and ready, which
            // is what can't be memorised.
            ...(isQuery
              ? { }
              : { body: { } }),
          });
        }
      }
    }
    return { routes: routes };
  }
}
