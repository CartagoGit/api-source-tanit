/**
 * `collectTaggedTemplates` — a `TaggedTemplateExpression` from the TS
 * AST, viewed from the frameworks adapter.
 *
 * (a00015 S1) Replaces `extractEmbeddedSdl` in `graphql.scanner.ts`.
 * The difference with the previous regex:
 *
 *   - The regex read `gql\`...\`` over `text` and matched anything
 *     that looked like an open backtick — including comments
 *     (`// gql\`...\``) and string literals (`"gql\`...\``"). Typical
 *     false positives: a README inside the code or a help text like
 *     "write gql\`type Query { ... }\`".
 *   - This implementation asks `@babel/parser` for the tree (the same
 *     parser used by `packages/core/language-frontends/typescript`)
 *     and returns the `TaggedTemplateExpression`s Babel recognises
 *     as such. A `// gql\`...\`` is inside a `CommentLine` node and
 *     never appears as a `TaggedTemplateExpression`; a `"gql\`...\``"
 *     is inside a `StringLiteral` and only the outer node is visible.
 *
 * It is not a new parser: `@babel/parser` is already in the lockfile
 * (`@babel/parser@7.29.8`) because of the TS frontend. All this
 * module does is expose a different view of the same tree — the
 * `TaggedTemplateExpression`s that the frontend discarded when it
 * kept only `imports / symbols / classes / methodCalls / assignments /
 * decorators`. Reusing the parser is the project's invariant (a00010
 * S7 — `core` does not import from `frameworks`, but both share
 * `@babel/parser`).
 *
 * Why `taggedTemplates` is NOT added to the frontend's `TSFile`:
 *   - The frontend is GraphQL-agnostic. A scanner that wants
 *     `gql\`...\`` and one that wants `html\`...\`` don't need to
 *     couple to the frontend's contract: each framework adapter
 *     mounts its own consumer on top of the raw AST.
 *   - The 6 scanners that already consume the frontend (Express,
 *     NestJS, Fastify, Hono, Next.js, tRPC) are not affected — they
 *     keep seeing the same `TSFile` as before.
 *
 * What the module does NOT do (a00015 non-goals):
 *   - Does not resolve types (`<T>`).
 *   - Does not follow imports across files.
 *   - Does not parse the template's contents (it is SDL untouched;
 *     the GraphQL scanner passes it through its own SDL parser).
 *   - Does not replace `extractEmbeddedSdl` directly: this module is
 *     a *shape*; the adapter that joins this shape with the GraphQL
 *     scanner lives in `S2` (`graphql-embedded.adapter.ts`).
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { parse as babelParse, type ParserPlugin } from "@babel/parser";
import type { IParseDiagnostic } from "../../contracts/interfaces/core/scanner.interface.js";
import { collectFiles, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";

/**
 * `ITaggedTemplate` is imported from
 * `contracts/interfaces/frameworks/typescript.interface.ts`
 * (the contract), which is where `lint:contracts` requires it. The
 * helper re-exports the type so consumers don't have to know the
 * contracts path.
 */
import type { ITaggedTemplate } from "../../contracts/interfaces/frameworks/typescript.interface.js";

export type { ITaggedTemplate };

/** Minimal shape of the Babel node this module needs to recognise. */
interface BabelNode {
  readonly type: string;
  readonly start?: number | null;
  readonly end?: number | null;
  readonly [key: string]: unknown;
}

/** Treats an `unknown` as a BabelNode (permissive cast, same pattern as the frontend). */
function asBabelNode(value: unknown): BabelNode {
  return value as BabelNode;
}

/** Array of unknowns → array of BabelNodes. */
function asArray(value: unknown): ReadonlyArray<BabelNode> {
  return Array.isArray(value) ? (value as ReadonlyArray<BabelNode>) : Array<BabelNode>();
}

/**
 * Indicates whether the file is JSX/TSX — same criterion as the
 * frontend (`packages/core/language-frontends/typescript/typescript.parser.ts`).
 * Without this, Babel rejects `<Foo />` with a syntax error and the
 * scanner loses the whole file.
 */
function isJsxFile(filename: string): boolean {
  return filename.endsWith(".tsx") || filename.endsWith(".jsx");
}

/**
 * Resolves the `tag` and `importBinding` of a `TaggedTemplateExpression`.
 *
 * Three shapes it recognises:
 *   - `gql\`...\``              → tag = "gql"
 *   - `graphql\`...\``          → tag = "graphql"
 *   - `Foo.Bar\`...\``          → tag = "Bar" (the MemberExpression's property)
 *
 * `importBinding` is only filled when the tag is a bare Identifier
 * (not a call nor a MemberExpression): in those cases the identifier
 * IS the local binding (`import { gql }`). In the other shapes there
 * is no single binding and it is left undefined — adapters that need
 * to resolve the source module will do that in another slice.
 */
function readTag(callee: BabelNode): { tag: string; importBinding?: string } | null {
  if (callee.type === "Identifier") {
    const name = String(callee.name ?? "");
    if (!name) return null;
    return { tag: name, importBinding: name };
  }
  if (callee.type === "MemberExpression") {
    const property = asBabelNode(callee["property"]);
    const propName = String(property.name ?? property.value ?? "");
    if (!propName) return null;
    // There is no single binding: the tag is the method's name
    // (`graphql` in `Foo.graphql\`...\``). The adapter can use `tag`
    // directly if it only cares about the short name.
    return { tag: propName };
  }
  if (callee.type === "CallExpression") {
    // `graphql(...)` is not a tagged template; we ignore it.
    return null;
  }
  return null;
}

/**
 * Walks the Babel tree in DFS and emits one `ITaggedTemplate` per
 * `TaggedTemplateExpression` found.
 *
 * Same pattern as `walk` in the frontend: visits EVERYTHING without
 * pruning, and the collectors decide what they care about. Here we
 * care about every `TaggedTemplateExpression`, without filtering by
 * tag — the tag filter is done by the adapter (S2), which knows the
 * list of tags it cares about (`gql`, `graphql`, ...).
 */
function walkForTaggedTemplates(
  body: ReadonlyArray<BabelNode>,
  sourceFile: string,
  out: ITaggedTemplate[],
): void {
  // We initialise the stack in reverse order so the first node of
  // `body` is processed first when we `pop()` — the result is a
  // top-down traversal of the file, which is what the SDL scanner
  // expects to populate `customScalars` before processing operations.
  const stack: BabelNode[] = [...body].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    if (node.type === "TaggedTemplateExpression") {
      const tagNode = asBabelNode(node["tag"]);
      const tagInfo = readTag(tagNode);
      if (tagInfo) {
        const quasi = asBabelNode(node["quasi"]);
        const start = typeof node.start === "number" ? node.start : 0;
        const end = typeof node.end === "number" ? node.end : start;
        // Babel's AST exposes the template's body as
        // `quasi.quasis: TemplateElement[]` — an array of fragments
        // separated by interpolations (`${…}`). Each `TemplateElement`
        // carries `value.raw` (the original textual form, with
        // literal `\n`) and `value.cooked` (the already-evaluated
        // form). The SDL scanner prefers `raw` to avoid losing line
        // breaks or escapes — which is what the SDL parser expects
        // to see.
        const quasis = asArray(quasi["quasis"]);
        // a00015 S4: `${…}` interpolations live in `quasi.expressions`,
        // not in `quasi.quasis`. A naive `.join("")` over the quasis
        // dropped them silently: `gql`${shared} …`` lost `${shared}`
        // — a common case in schema/fragment composition. We do not
        // resolve them here (that is the API IR job from a00016); we
        // insert a deterministic sentinel per expression so the piece
        // never disappears without a trace. A template with N
        // expressions has N+1 quasis.
        const expressions = asArray(quasi["expressions"]);
        const hasInterpolation = expressions.length > 0;
        let raw = "";
        for (let i = 0; i < quasis.length; i += 1) {
          // `value` is an object `{ raw: string, cooked?: string }` —
          // Babel exposes both on `TemplateElement`. The cast to
          // `Record<string, unknown>` is the permissive form that
          // shares the frontend's pattern (a00010 S7): without
          // importing `@babel/types`.
          const value = quasis[i]?.["value"] as Record<string, unknown> | undefined;
          const rawText = value?.["raw"];
          raw += typeof rawText === "string" ? rawText : "";
          if (i < expressions.length) {
            raw += `__TANIT_INTERP_${i}__`;
          }
        }
        out.push({
          tag: tagInfo.tag,
          ...(tagInfo.importBinding !== undefined
            ? { importBinding: tagInfo.importBinding }
            : {}),
          raw,
          range: { start, end },
          sourceFile,
          ...(hasInterpolation ? { hasInterpolation: true } : {}),
        });
      }
    }

    // Children: any field that is an object/array with `type`. We
    // push them in REVERSE order onto the stack so the first child
    // comes out first when we `pop()` — the result is a top-down
    // traversal of the file (so the SDL scanner can populate
    // `customScalars` before processing operations — second review
    // of the audit `2026-09-04 P1 #12`).
    const children: BabelNode[] = [];
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in item) {
            children.push(asBabelNode(item));
          }
        }
      } else if (value && typeof value === "object" && "type" in value) {
        children.push(asBabelNode(value));
      }
    }
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
}

/**
 * Parses a TS/JS file and returns its `TaggedTemplateExpression`s.
 *
 * If Babel cannot parse the file, logs the reason in `diagnostics`
 * (if the array was passed) and returns `[]` — the caller decides
 * what to do. This is the same contract as `parseModule` in the
 * frontend (a00011 C-7 / B-rev-13): a file with weird syntax does not
 * abort the scan, but the failure stays visible for whoever wants to
 * report it.
 */
export function collectTaggedTemplatesFromSource(
  source: string,
  filename: string,
  diagnostics?: Array<IParseDiagnostic>,
): ITaggedTemplate[] {
  const plugins: ParserPlugin[] = ["typescript", "decorators"];
  if (isJsxFile(filename)) plugins.push("jsx");

  try {
    const ast = babelParse(source, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      plugins: [...plugins],
      errorRecovery: true,
    });
    const body = asArray(ast.program["body"]);
    const out: ITaggedTemplate[] = [];
    walkForTaggedTemplates(body, filename, out);
    return out;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    diagnostics?.push({ file: filename, severity: "error", reason });
    return [];
  }
}

/**
 * Walks the TS/JS source under `projectRoot` and returns all the
 * `TaggedTemplateExpression`s it finds.
 *
 * Uses `collectFiles(projectRoot, isSourceJsTsFile)` — the same helper
 * that `express.scanner.ts` and `graphql.scanner.ts` already use to
 * locate TS/JS files — so it honours the same excludes
 * (`node_modules`, `dist`, etc.) without reinventing the wheel.
 *
 * `diagnostics` (optional) receives the files the parser could not
 * digest. If not passed, failures are swallowed silently — the
 * "degradable" form used by tests that only want to verify the
 * tree shape.
 */
export async function collectTaggedTemplates(
  projectRoot: string,
  diagnostics?: Array<IParseDiagnostic>,
): Promise<ITaggedTemplate[]> {
  const files = await collectFiles(projectRoot, isSourceJsTsFile);
  const out: ITaggedTemplate[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      // The file disappeared between `collectFiles` and `readFile` (a
      // test that writes and deletes, or an editor mid-save).
      // We don't abort the scan for that.
      continue;
    }
    // `relative` only so `sourceFile` is readable in logs; the adapter
    // doesn't use it and, if it needs to, can resolve it itself. If
    // `relative` fails (path outside projectRoot), we fall back to
    // the absolute path — it is still a valid identifier and lets the
    // caller know which file the template came from.
    const rel = relative(projectRoot, file) || file;
    out.push(...collectTaggedTemplatesFromSource(text, rel, diagnostics));
  }
  return out;
}