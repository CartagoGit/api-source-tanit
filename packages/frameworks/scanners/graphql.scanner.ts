/**
 * `GraphQLScanner` — `.graphql` / `.gql` schemas and embedded SDL.
 *
 * GraphQL has no routes: it has **one** endpoint — `/graphql` almost
 * always — and what changes is the body. So here a collection
 * "endpoint" is a schema **operation**: each field of `type Query` and
 * `type Mutation` comes out as a `POST /graphql` with its query
 * already written in the body.
 *
 * That's what makes the collection useful: whoever imports it hits
 * Send and the query runs. A collection with a single `POST /graphql`
 * and an empty body saves nothing — writing the query was exactly the
 * work.
 *
 * Subscriptions are **not** emitted. They go over WebSocket, and an
 * HTTP request to `/graphql` with a `subscription` inside doesn't work:
 * the server responds with an error. Emitting it would deliver
 * something that fails on the first Send — worse than not delivering it.
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
import { collectFiles } from "../../core/helpers/fs-walk.helper.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";
import { collectTaggedTemplates } from "../typescript/tagged-template.helper.js";
import { collectEmbeddedSdl } from "./graphql-embedded.scanner.js";

/** Packages that give away a GraphQL server. */
const GRAPHQL_PACKAGES = [
  "graphql",
  "@apollo/server",
  "apollo-server",
  "apollo-server-express",
  "graphql-yoga",
  "@nestjs/graphql",
  "type-graphql",
  "mercurius",
];

/** Path where almost everyone mounts the endpoint. */
const DEFAULT_ENDPOINT = "/graphql";

/** Built-in scalars. They don't allow field selection. */
const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);

/**
 * Returns true if the type (without `[`, `]`, `!`) is a scalar.
 *
 * Audit 2026-09-04 (second review): the previous `customScalars` was
 * a module-level Set. Two consecutive scans (especially in
 * `Promise.all` with different projects) would contaminate their
 * scalars: the second project would inherit the first's `scalar X`.
 * The `IScanResult` contract explicitly requires the scanner to keep
 * no state between calls (which is what justifies `scan()` taking
 * `match` as argument and returning routes by value). Now
 * `customScalars` is **local to each `scan()`** and passed as an
 * argument to pure functions.
 */
function isScalarType(type: string, customScalars: ReadonlySet<string>): boolean {
  const bare = type.replace(/[[\]!]/g, "");
  return BUILTIN_SCALARS.has(bare) || customScalars.has(bare);
}

/** Schema files. */
function isSchemaFile(name: string): boolean {
  return name.endsWith(".graphql") || name.endsWith(".gql");
}

/**
 * Lockfiles present in `projectRoot` as bonus runtime signals.
 *
 * f00011 S4: `pnpm-lock.yaml` and Bun lockfiles refine the detector's
 * confidence without being detection. Small weights: +0.1 (pnpm),
 * +0.15 (bun). The GraphQL detector sums evidence and then returns
 * the `Math.max(fromPackage, 0.5)` or `1`; the bonus shows up in
 * `evidence` even though the cap doesn't let it move the visible
 * score — exactly what this proposal wants: runtime traceability,
 * not new detection.
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

export class GraphQlProjectScanner implements IProjectScanner {
  readonly framework = "graphql" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const pkgPath = join(projectRoot, "package.json");
    let fromPackage = 0;
    const signals: Array<{ signal: string; weight: number; artifact?: string }> = [];
    if (existsSync(pkgPath)) {
      const parsed = parseJson(await readFile(pkgPath, "utf8"));
      if (parsed.ok && isRecord(parsed.value)) {
        const deps = {
          ...((parsed.value["dependencies"] as Record<string, string>) ?? {}),
          ...((parsed.value["devDependencies"] as Record<string, string>) ?? {}),
        };
        if (GRAPHQL_PACKAGES.some((name) => deps[name])) {
          fromPackage = 0.8;
          signals.push({ signal: "package.json declara un paquete GraphQL", weight: 0.8, artifact: "package.json" });
        }
      }
    }

    // f00011 S4: lockfile as runtime bonus. Accumulated in `signals`
    // so it appears in `evidence` regardless of which branch ends
    // up returning the result. Added at the end so a lockfile can't
    // mask an absent framework — `package.json` or schema detection
    // always goes first.
    for (const lock of lockfileSignals(projectRoot)) signals.push(lock);

    // A `.graphql` with `type Query` is the strongest signal there
    // is: it doesn't depend on the ecosystem or the package manager,
    // so it also recognises a Go, Python, or Java schema.
    const schemas = await collectFiles(projectRoot, isSchemaFile);
    if (schemas.length === 0) {
      return signals.length > 0
        ? withEvidence(fromPackage, signals)
        : emptyResult(0);
    }
    // Audit 2nd review #14: before, if there were `.graphql` files but
    // none contained `type Query/Mutation`, we returned
    // `emptyResult(0.5)`. A frontend project with only fragments or
    // auxiliary types ended up marked as a GraphQL server. Now only
    // the manifest scores when there's no `type Query`. Loose
    // `.graphql` files are no longer evidence of a server.
    for await (const entry of readFilesInOrder(schemas)) {
      const text = entry.text;
      if (/\btype\s+(Query|Mutation)\b/.test(text)) {
        return withEvidence(1, [
          { signal: `Esquema GraphQL con type Query/Mutation (${entry.path})`, weight: 1, artifact: entry.path },
          ...signals,
        ]);
      }
    }
    // Without Query/Mutation: if the manifest doesn't score, it's not
    // a GraphQL server (even if there are `.graphql` files). We drop
    // to 0 to avoid contaminating the detection.
    return signals.length > 0
      ? withEvidence(fromPackage, signals)
      : emptyResult(0);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = [];
    if (existsSync(join(projectRoot, "package.json"))) artifacts.push("package.json");
    for (const file of await collectFiles(projectRoot, isSchemaFile)) {
      artifacts.push(relative(projectRoot, file));
    }
    return { framework: "graphql", projectRoot, artifacts };
  }
}

/** A field of `type Query` or `type Mutation`. */
interface IOperation {
  readonly kind: "query" | "mutation";
  readonly name: string;
  /** Declared arguments, with their type as it appears in the schema. */
  readonly args: ReadonlyArray<{ name: string; type: string }>;
  readonly returns: string;
}

/** `#` comments and `"""…"""` descriptions out of the way. */
export function stripGraphQlComments(source: string): string {
  return source
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/^\s*#.*$/gm, "");
}

/**
 * The body of `type X { … }`, with balanced braces.
 *
 * `indexOf("}")` doesn't cut it: a field can carry a type with braces
 * in its description, and above all a schema with several types
 * would cut at the first close it finds.
 */
function typeBody(source: string, typeName: string): string | null {
  const header = new RegExp(`\\btype\\s+${typeName}\\b[^{]*\\{`).exec(source);
  if (!header) return null;
  const open = header.index + header[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Collects the custom scalars declared in the schema with the
 * `scalar Name` directive. Audit 2026-09-04 P1 #4 + second review.
 *
 * Returns a NEW Set per call: the caller owns the state and decides
 * when to initialise it. This honours the `IScanResult` contract
 * (the scanner keeps no state between calls) and lets
 * `Promise.all([scan(A), scan(B)])` not contaminate B with A's
 * scalars.
 */
export function collectCustomScalars(source: string): Set<string> {
  const out = new Set<string>();
  const cleaned = stripGraphQlComments(source);
  // Recognises `scalar X` and `scalar X @directive(...)` (audit
  // second review #13). The block after `scalar` may carry directives
  // before the newline; if there are any, the name isn't counted.
  const re = /^\s*scalar\s+(\w+)(?:\s+@\w+[\s\S]*?)?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[1] && !BUILTIN_SCALARS.has(m[1])) out.add(m[1]);
  }
  return out;
}

/**
 * The fields of a type block.
 *
 * A field is `name(args): Type`. Arguments may carry default values
 * and nested types, so we slice by balanced parentheses rather than
 * by regex.
 */
export function parseOperations(
  source: string,
  kind: "query" | "mutation",
): IOperation[] {
  const clean = stripGraphQlComments(source);
  const body = typeBody(clean, kind === "query" ? "Query" : "Mutation");
  if (body === null) return [];

  const out: IOperation[] = [];
  const fieldRe = /(\w+)\s*(\(([\s\S]*?)\))?\s*:\s*([\w[\]!]+)/g;
  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(body)) !== null) {
    const name = match[1] ?? "";
    const rawArgs = match[3] ?? "";
    const returns = match[4] ?? "";
    if (!name) continue;

    const args: Array<{ name: string; type: string }> = [];
    for (const arg of rawArgs.split(",")) {
      const parsed = /(\w+)\s*:\s*([\w[\]!]+)/.exec(arg);
      if (parsed?.[1] && parsed[2]) args.push({ name: parsed[1], type: parsed[2] });
    }
    out.push({ kind, name, args, returns });
  }
  return out;
}

/**
 * The query ready to send.
 *
 * Arguments go as **variables**, not embedded in the text: that's what
 * lets you change them from the Postman panel without editing the
 * query, and what keeps a `String!` from ending up without quotes.
 */
export function buildQueryDocument(
  op: IOperation,
  customScalars: ReadonlySet<string> = new Set<string>(),
): string {
  const declaration =
    op.args.length > 0
      ? `(${op.args.map((a) => `$${a.name}: ${a.type}`).join(", ")})`
      : "";
  const call =
    op.args.length > 0
      ? `(${op.args.map((a) => `${a.name}: $${a.name}`).join(", ")})`
      : "";
  // An object needs field selection and a scalar does not accept it:
  // putting one on a `String!` produces an **invalid** query, which
  // is worse than not putting it.
  //
  // The scalars GraphQL ships with start with an uppercase letter, same
  // as objects, so looking at the first letter isn't enough: you have
  // to name them. A custom scalar (`DateTime`, `JSON`) cannot be
  // distinguished from an object without resolving the whole schema;
  // in doubt we ask for `__typename` — which exists on any object and
  // makes the query valid.
  const bare = op.returns.replace(/[[\]!]/g, "");
  const selection = isScalarType(bare, customScalars)
    ? ""
    : " {\n    __typename\n  }";
  return `${op.kind} ${op.name}${declaration} {\n  ${op.name}${call}${selection}\n}`;
}

/** Example value for a variable, by its GraphQL type. */
function exampleForType(
  type: string,
  customScalars: ReadonlySet<string>,
): unknown {
  const bare = type.replace(/[[\]!]/g, "");
  if (type.startsWith("[")) return [];
  switch (bare) {
    case "Int":
      return 1;
    case "Float":
      return 1.0;
    case "Boolean":
      return true;
    case "ID":
      return "1";
    case "String":
      return "texto";
    default:
      // Audit 2026-09-04 P1 #4: if it's a custom scalar declared by
      // the schema, we return a placeholder string (custom scalars
      // usually serialise as string: `DateTime`, `UUID`,
      // `EmailAddress`). Otherwise it's a custom input type: an empty
      // object is the honest choice, because its fields live elsewhere
      // in the schema and guessing them would be inventing.
      return isScalarType(bare, customScalars) ? "valor" : {};
  }
}

export class GraphQlRouteScanner implements IRouteScanner {
  readonly framework = "graphql" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "graphql";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    // Audit 2026-09-04 P1 #5 (embedded SDL): before, the scanner only
    // looked at `.graphql`/`.gql`, but a server-side project may
    // declare the schema inline with `gql\`...\``. If the server
    // had no `.graphql` on disk, the scanner returned 0 operations.
    // Now it also walks `.ts`/`.js`/`.tsx`/`.jsx` and extracts the
    // `gql\`…\`` blocks before applying the parser.
    const schemaFiles = await collectFiles(effectiveProjectRoot(match), isSchemaFile);

    // a00015 S1+S2+S3: the scanner now delegates embedded-SDL
    // extraction to the TS AST (collectTaggedTemplates →
    // collectEmbeddedSdl). Before, a regex on each file
    // (`extractEmbeddedSdl(text)`) matched false positives in
    // comments (`// gql\`...\``) and strings (`"gql\`...\``) — see
    // proposal a00015. The AST doesn't get it wrong: a
    // TaggedTemplateExpression only appears as such when Babel
    // recognises the real syntax.
    //
    // The extracted SDLs are returned as string[] in the top-down
    // order of the TaggedTemplateExpressions: the scanner passes
    // them through `collectCustomScalars` and `scanSchema` in that
    // same order. `customScalars` must be populated before
    // generating operations (second review of audit 2026-09-04 P1 #12).
    const embeddedSdl: string[] = collectEmbeddedSdl(
      await collectTaggedTemplates(effectiveProjectRoot(match)),
    );

    // Audit second review #10 (custom scalars + scan cycle):
    // two passes. The first collects all custom scalars across the
    // whole project (not just the `type Query` block); the second
    // generates operations with that Set as reference. This closes
    // the bug "scalar DateTime in 99-scalars.graphql isn't seen when
    // 00-query.graphql is parsed first". The Set is local to this
    // `scan()` — never shared between calls (second review, P1).
    const customScalars = new Set<string>();
    for await (const { text } of readFilesInOrder(schemaFiles)) {
      for (const scalar of collectCustomScalars(text)) customScalars.add(scalar);
    }
    for (const sdl of embeddedSdl) {
      for (const scalar of collectCustomScalars(sdl)) customScalars.add(scalar);
    }

    const routes: ParsedRoute[] = [];
    const seen = new Set<string>();

    for await (const { path, text } of readFilesInOrder(schemaFiles)) {
      const sourceFile = relative(rawProjectRoot(match), path);
      for (const op of scanSchema(
        text,
        sourceFile,
        seen,
        routes,
        customScalars,
      )) {
        routes.push(op);
      }
    }

    // Embedded SDL: AST-derived `gql\`...\`` blocks from TS/JS. The
    // first `.graphql` schema containing `type Query` already
    // counts as a server; this step is complementary and only adds
    // new operations (the `seen` dedupe avoids duplicates).
    for (const sdl of embeddedSdl) {
      for (const op of scanSchema(sdl, "<embedded>", seen, routes, customScalars)) {
        routes.push(op);
      }
    }
    return { routes: routes };
  }
}

/**
 * Extracts operations (Query/Mutation) from an SDL text and appends
 * them to `routes` if they aren't in `seen`. Returns the added ones
 * so the caller can chain.
 *
 * `customScalars` is supplied by the caller (typically the scanner's
 * `scan()`) after a prior pass over the whole project's SDL — which
 * avoids the second-review #12 bug ("custom scalar in another file
 * isn't seen if the operations file is processed first").
 */
function scanSchema(
  sdl: string,
  sourceFile: string,
  seen: Set<string>,
  _routes: ParsedRoute[],
  customScalars: ReadonlySet<string>,
): ParsedRoute[] {
  const added: ParsedRoute[] = [];
  for (const kind of ["query", "mutation"] as const) {
    for (const op of parseOperations(sdl, kind)) {
      const seenKey = `${op.kind}:${op.name}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);

      const variables = Object.fromEntries(
        op.args.map((a) => [a.name, exampleForType(a.type, customScalars)]),
      );
      const route: ParsedRoute = {
        method: "POST",
        uri: DEFAULT_ENDPOINT,
        rawUri: DEFAULT_ENDPOINT,
        sourceFile,
        lineNumber: 1,
        prefixChain: [],
        displayName: `${op.kind} ${op.name}`,
        description: `${op.kind} \`${op.name}\` → \`${op.returns}\``,
        tags: [op.kind === "query" ? "Queries" : "Mutations"],
        body: {
          query: buildQueryDocument(op, customScalars),
          variables,
        },
      };
      added.push(route);
    }
  }
  return added;
}

// `scanSchema` is kept as a local helper (not exported) — only the
// scanner's own `scan()` uses it.
