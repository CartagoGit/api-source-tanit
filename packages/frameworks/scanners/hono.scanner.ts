/**
 * `HonoScanner` — `IProjectScanner` + `IRouteScanner` for Hono.
 *
 * Hono is the edge-runtime framework: Cloudflare Workers, Deno, Bun,
 * and Node. Its syntax looks like Express's, but with two differences
 * that matter for scanning:
 *
 *   - **It chains**: `app.get("/a", h).post("/b", h)` is valid, so
 *     looking for `<ident>.method(` is not enough.
 *   - **It mounts sub-apps**: `app.route("/api", usersApp)` is the
 *     equivalent of a router with prefix.
 *
 * Validation: Hono delegates it to `@hono/zod-validator`, which wraps a
 * zod schema. We reuse the existing zod parser rather than writing a new
 * one — same library, just a different caller.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { collectFiles, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { findAllBalanced, findOutsideStrings, stripJsComments } from "../../core/helpers/source-scan.helper.js";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import { parseZodObjectLiteral, zodFieldToSpec } from "../parsers/zod-schema.helper.js";
import type {
  IEndpointValidation,
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IValidatorDescriptor,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "options", "all"] as const;

/**
 * A call to an HTTP method with its path.
 *
 * It deliberately does not require an identifier in front, just to
 * cover chaining: in `app.get("/a", h).post("/b", h)`, `.post` has no
 * variable of its own.
 */
const ROUTE_RE = new RegExp(
  String.raw`\.\s*(${HTTP_METHODS.join("|")})\s*\(\s*(['"\`])([^'"\`]+)\2`,
  "gi",
);

/** `app.route("/api", sub)` — the equivalent of mounting a router. */
const MOUNT_RE = /\.\s*route\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([\w$]+)/g;

/** `zValidator("json", ZodSchema)` from `@hono/zod-validator`. */
const ZOD_VALIDATOR_RE = /zValidator\s*\(\s*(['"`])(\w+)\1\s*,\s*([\w$]+)/g;

/** Which part of the request each `zValidator` target validates. */
const TARGET_TO_LOCATION: Record<string, IValidationSpec["location"]> = {
  json: "body",
  form: "body",
  query: "query",
  param: "path",
  header: "header",
  cookie: "cookie",
};

async function readPackageJson(projectRoot: string): Promise<Record<string, unknown> | null> {
  const path = join(projectRoot, "package.json");
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  const parsed = parseJson(raw);
  if (!parsed.ok) return null;
  return isRecord(parsed.value) ? parsed.value : null;
}

function honoDeps(pkg: Record<string, unknown> | null): Record<string, string> {
  if (!pkg) return {};
  return {
    ...((pkg["dependencies"] as Record<string, string>) ?? {}),
    ...((pkg["devDependencies"] as Record<string, string>) ?? {}),
  };
}

/**
 * Returns the effective root where this scanner looks at its sources.
 *
 * If `IProjectMatch` carries `frameworkSearchRoot` (filled by the host
 * after monorepo detection), it's joined with `projectRoot`. If absent,
 * `projectRoot` is returned unchanged.
 *
 * Renamed locally (`honoEffectiveSearchRoot`) for the same reason as in
 * `nestjs.scanner.ts`: each scanner has its own implementation because
 * each one needs a different search root. f00011 S1.
 *
 * a00014 S2: now delegated to `effectiveProjectRoot(match)` from
 * `packages/core/discovery/effective-project-root.helper.ts`, the single
 * primitive all 21 scanners use. The local helper is kept as a historic
 * no-op so external call sites don't break, but the scanner no longer
 * uses it.
 */
function honoEffectiveSearchRoot(match: IProjectMatch): string {
  return effectiveProjectRoot(match);
}

/**
 * Lockfiles present in `projectRoot` as bonus runtime signals.
 *
 * f00011 S4: `pnpm-lock.yaml` and Bun lockfiles refine the detector's
 * confidence without being detection. Small weights: +0.1 (pnpm),
 * +0.15 (bun) — Bun is especially relevant for Hono because it's one
 * of the edge runtimes Hono supports as first-class. The cap at 1
 * that `withEvidence` applies absorbs the case of Hono with `hono`
 * declared, where the bonus stays in `evidence` even though it
 * doesn't change the visible score.
 *
 * x00035 S1: Bun ≥ 1.2 emits `bun.lock` (text) and Bun < 1.2 emits
 * `bun.lockb` (binary). Both are accepted; if both are present
 * (degenerate case, modern project with a stale binary lock), the
 * modern `bun.lock` wins and `bun.lockb` is ignored.
 */
function lockfileSignals(projectRoot: string): Array<{ signal: string; weight: number; artifact?: string }> {
  const out: Array<{ signal: string; weight: number; artifact?: string }> = [];
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

export class HonoProjectScanner implements IProjectScanner {
  readonly framework = "hono" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const deps = honoDeps(await readPackageJson(projectRoot));
    // f00011 S4: lockfile as runtime bonus. Computed once here and
    // added at the end of each positive branch so a lockfile can't
    // mask an absent framework — dependency or `wrangler.toml`
    // detection always goes first.
    const locks = lockfileSignals(projectRoot);
    if (deps["hono"]) {
      const evidence: Array<{ signal: string; weight: number; artifact?: string }> = [
        { signal: "package.json declares hono in dependencies/devDependencies", weight: 1, artifact: "package.json" },
      ];
      // `wrangler.toml` stays as a runtime BONUS when `hono` is
      // already in deps: it describes Hono's typical deployment
      // (Cloudflare Workers) and refines the evidence. It is **not**
      // a framework signal by itself — a `wrangler.toml` without
      // hono is Cloudflare Workers, not Hono (audit 2026-09-04 P2
      // #8: before, the detector added 0.6 for wrangler.toml alone,
      // silently classifying itty-router / vanilla Workers projects
      // as Hono).
      if (existsSync(join(projectRoot, "wrangler.toml"))) {
        evidence.push({
          signal: "wrangler.toml presente (runtime de borde)",
          weight: 0.6,
          artifact: "wrangler.toml",
        });
      }
      for (const lock of locks) evidence.push(lock);
      return withEvidence(evidence.reduce((a, s) => a + s.weight, 0), evidence);
    }
    // Only an `@hono/*` could be from a project that uses it incidentally.
    const pluginMatch = Object.keys(deps).some((name) => name.startsWith("@hono/"));
    if (pluginMatch) {
      const evidence: Array<{ signal: string; weight: number; artifact?: string }> = [
        { signal: "package.json only declares @hono/* plugins (incidental use)", weight: 0.6, artifact: "package.json" },
        ...locks,
      ];
      const lockBonus = locks.reduce((a, e) => a + e.weight, 0);
      return withEvidence(0.6 + lockBonus, evidence);
    }
    // Audit 2026-09-04 P2 #8: `wrangler.toml` without hono declared
    // is NO LONGER classified as Hono. Before, it added 0.6, which
    // caused false positives: a worker with itty-router, vanilla
    // Workers, Remix on Cloudflare, etc., ended up as Hono. Now a
    // hono dependency (or `@hono/*`) is required to enter the
    // detector. `wrangler.toml` stays as evidence only when it
    // complements an already-positive hono detection.
    return emptyResult(0);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const deps = honoDeps(await readPackageJson(projectRoot));
    const artifacts: string[] = ["package.json"];
    if (existsSync(join(projectRoot, "wrangler.toml"))) artifacts.push("wrangler.toml");
    return {
      framework: "hono",
      projectRoot,
      artifacts,
      ...(deps["hono"] ? { version: deps["hono"] } : {}),
    };
  }
}

export class HonoRouteScanner implements IRouteScanner {
  readonly framework = "hono" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "hono";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    // f00011 S1: in monorepos the host passes `frameworkSearchRoot`
    // (e.g. `"apps/api"`) and the scanner walks there instead of at
    // the root. Without this, a Hono project inside a worker monorepo
    // came out without routes because `src/` lives in the subdir.
    // The root stays in `match.projectRoot` so the routes
    // (`sourceFile`) keep being relative to the host project.
    const searchRoot = honoEffectiveSearchRoot(match);
    const files = await collectFiles(searchRoot, isSourceJsTsFile);
    const routes: ParsedRoute[] = [];
    // `validators` lives here, not as an instance field: if it
    // survived across calls, two consecutive scans would share
    // descriptors and a `GET /health` without a zValidator could
    // inherit the one from the previous scan's `POST /users`. This
    // is the bug a00010 S2 closed.
    const validators = new Map<string, IValidatorDescriptor>();

    // Parallel reads with a cap, delivered in input order: the
    // collection must come out identical every time.
    for await (const { path: file, text: raw } of readFilesInOrder(files)) {
      if (!/\bhono\b|new Hono\(/i.test(raw)) continue;

      const source = stripJsComments(raw);
      const sourceFile = relative(rawProjectRoot(match), file);
      const prefix = mountPrefixOf(source);

      // `findOutsideStrings` instead of `matchAll`: a call written inside
      // a string —`'usa app.get("/x")'`— is not a route, and used to
      // produce an endpoint that doesn't exist anywhere.
      for (const { match: routeMatch, index } of findOutsideStrings(source, ROUTE_RE)) {
        const rawMethod = (routeMatch[1] ?? "").toLowerCase();
        const rawUri = routeMatch[3] ?? "";
        if (!rawUri.startsWith("/")) continue;

        // `.all()` answers to any HTTP method. We emit it as the
        // sentinel method `"ALL"` so the semantic meaning survives
        // through the pipeline and exporters can decide how to
        // materialize it (Postman supports `ANY`; OpenAPI/HAR/Bruno
        // get their own per-format treatment in follow-up slices).
        //
        // Audit 2026-09-06 §13: emitting `"GET"` here was wrong
        // — `.all()` is not "the most common method", it is "every
        // method". Collapsing it to GET made collections look
        // complete while leaving 6 of 7 methods undocumented, and
        // the user had no signal that anything was missing.
        const method = rawMethod === "all" ? "ALL" : rawMethod.toUpperCase();
        const uri = joinRoutePath(prefix, rawUri);

        routes.push({
          lineNumber: lineOf(source, index),
          method,
          uri,
          rawUri,
          sourceFile,
          prefixChain: prefix ? [prefix] : [],
        });

        const validator = validatorInCall(source, routeMatch.index ?? 0);
        if (validator) {
          validators.set(`${method} ${uri}`, { name: validator.schema, file });
        }
      }
    }

    const unique = dedupe(routes);
    return {
      routes: unique,
      ...(validators.size > 0 ? { validators } : {}),
    };
  }
}

/**
 * Prefix under which this file is mounted, if it is mounted under one.
 *
 * Only applies when there is **one** mount in the file: with several,
 * we can't tell which one corresponds to which route without following
 * variables, and getting the prefix wrong is worse than putting none.
 */
function mountPrefixOf(source: string): string {
  const mounts = [...source.matchAll(MOUNT_RE)].map((m) => m[2] ?? "");
  return mounts.length === 1 ? (mounts[0] ?? "") : "";
}

/**
 * The `zValidator(...)` of a route, searched **within its own call**.
 *
 * With a character window, an `app.get("/health", h)` without a
 * validator would take the one from the route below it and come out
 * with foreign rules. Balancing the parens, a route without a
 * validator finds none.
 */
function validatorInCall(
  source: string,
  routeStart: number,
): { schema: string; target: string } | null {
  const parenAt = source.indexOf("(", routeStart);
  if (parenAt === -1) return null;

  let depth = 0;
  let callEnd = -1;
  for (let i = parenAt; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) {
        callEnd = i;
        break;
      }
    }
  }
  if (callEnd === -1) return null;

  const call = source.slice(parenAt, callEnd);
  const match = ownRegex(ZOD_VALIDATOR_RE).exec(call);
  if (!match) return null;
  return { target: match[2] ?? "json", schema: match[3] ?? "" };
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

function dedupe(routes: ReadonlyArray<ParsedRoute>): ParsedRoute[] {
  const seen = new Set<string>();
  const out: ParsedRoute[] = [];
  for (const route of routes) {
    const key = `${route.method} ${route.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(route);
  }
  return out;
}

/**
 * Rules from `@hono/zod-validator`.
 *
 * Reuses the existing zod parser: it's the same library as in Express
 * or Next.js, only the caller changes. Writing a second zod parser
 * would be the fastest way for the two to drift apart.
 *
 * It does not retain the scanner: the schema name and the file where
 * it is declared ride in `scanResult.validators`, which is filled on
 * each `scan()` and discarded when it ends. Before it had
 * `private readonly scanner: HonoRouteScanner` and an instance `Map`,
 * and two consecutive scans would contaminate each other (a00010 S2).
 */
export class HonoZodValidatorProvider implements IValidationSpecProvider {
  readonly framework = "hono" as const;

  async supports(
    route: ParsedRoute,
    _match: IProjectMatch,
    scanResult: IScanResult,
  ): Promise<boolean> {
    return scanResult.validators?.has(`${route.method} ${route.uri}`) ?? false;
  }

  async resolve(
    route: ParsedRoute,
    _match: IProjectMatch,
    scanResult: IScanResult,
  ): Promise<IEndpointValidation> {
    const endpointKey = `${route.method} ${route.uri}`;
    const validator = scanResult.validators?.get(`${route.method} ${route.uri}`);
    if (!validator) return { endpointKey, fields: [] };

    let source: string;
    try {
      source = stripJsComments(await readFile(validator.file, "utf8"));
    } catch {
      return { endpointKey, fields: [] };
    }

    const location = locationOfValidator(source, validator.name);
    const literal = zodObjectLiteralOf(source, validator.name);
    if (!literal) return { endpointKey, fields: [] };

    const fields = parseZodObjectLiteral(literal).map((field) =>
      zodFieldToSpec(field, location),
    );
    return { endpointKey, fields };
  }
}

/**
 * The literal of `z.object({…})` that declares a named schema.
 *
 * Uses `findAllBalanced`, which is the same path the Express scanner
 * follows for the same thing. Writing another brace walk here would
 * keep two implementations of the same idea, and the second one is
 * always the one that goes unfixed.
 *
 * The slice **includes** the braces: that's what
 * `parseZodObjectLiteral` expects, and the convention the other
 * scanners already followed.
 */
function zodObjectLiteralOf(source: string, schemaName: string): string | null {
  const declaration = new RegExp(
    String.raw`(?:const|let|var)\s+${schemaName}\s*(?::[^=]+)?=\s*z\s*\.\s*object\s*`,
    "g",
  );
  const call = findAllBalanced(source, declaration)[0];
  if (!call) return null;
  return source.slice(call.callStart + 1, call.callEnd);
}

/** Where a schema's fields go, according to the validator's target. */
function locationOfValidator(source: string, schemaName: string): IValidationSpec["location"] {
  let match: RegExpExecArray | null;
  const zodValidatorRe = ownRegex(ZOD_VALIDATOR_RE);
  while ((match = zodValidatorRe.exec(source)) !== null) {
    if (match[3] === schemaName) return TARGET_TO_LOCATION[match[2] ?? "json"] ?? "body";
  }
  return "body";
}
