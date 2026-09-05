/**
 * `graphql-embedded.adapter` — consumes the TS AST to deliver embedded SDL.
 *
 * (a00015 S2) Replaces `extractEmbeddedSdl(text)` from
 * `graphql.scanner.ts`, which read each TS/JS file with a regex on
 * `gql\`...\`` and returned the contents between backticks. The regex
 * had two false positives that the issues base knew about:
 *
 *   1. `// gql\`type Query { fake: String }\`` — a comment with
 *      example code. The regex saw `gql\`` and returned the fictitious SDL.
 *   2. `"gql\`type Query { fake: String }\`"` — a string literal with
 *      GraphQL syntax as help text. The regex saw `gql\`` inside the
 *      string and returned a fictitious SDL.
 *
 * The AST doesn't get these wrong: a `TaggedTemplateExpression` only
 * appears as such when the parser recognises the real syntax; a
 * `// gql\`` is inside a `CommentLine` and a `"gql\`` is inside a
 * `StringLiteral`. Reusing the TS frontend's AST is the project's
 * invariant (a00010 S7 — `core` doesn't import from `frameworks`, but
 * both share `@babel/parser`).
 *
 * ## Shape
 *
 * The adapter is **pure**: it only projects the `ITaggedTemplate`s
 * matching the scanner's tag list into SDL strings.
 *
 *   `collectEmbeddedSdl(templates, options?)` → `string[]`
 *
 * The scanner iterates the list and feeds it through its existing
 * SDL parser (`parseOperations` + `scanSchema`) — the adapter does
 * not touch SDL parsing because the scanner already knows how.
 *
 * ## Tag filtering
 *
 * By default `["gql", "graphql"]` are accepted. It's the list the
 * previous regex recognised, copied verbatim from the comment that
 * justified it. If another name appears tomorrow (e.g. `parsed.gql`,
 * `Foo.gql`), just pass it in `options.tags`. The adapter does NOT
 * case-fold or normalise — the scanner expects an exact match, just
 * like the previous regex.
 *
 * ## Interpolations
 *
 * The previous regex cleaned `${...}` interpolations by leaving them
 * empty. The AST delivers `cooked` with placeholders already
 * resolved to their values — but real `gql\`...\`` rarely carry
 * runtime interpolations in the SDL body (types don't contain
 * variables). When they do, we keep the raw text as-is; the
 * downstream SDL parser will report an honest syntax error instead
 * of swallowing it. Default behaviour aligned with the current
 * scanner.
 */
import type { ITaggedTemplate } from "../typescript/tagged-template.helper.js";

/** Tags the scanner recognises as embedded-SDL labels. */
const DEFAULT_TAGS: ReadonlyArray<string> = ["gql", "graphql"];

/** Adapter options — the contract lives in `contracts/`. */
import type { ICollectEmbeddedSdlOptions } from "../../contracts/interfaces/frameworks/scanners.interface.js";

export type { ICollectEmbeddedSdlOptions };

/**
 * Returns the SDL strings extracted from `templates` whose tag is
 * in the `options.tags` list (or `DEFAULT_TAGS` if not passed).
 *
 * The output array order follows the templates' order: top-down per
 * file, then file by file in the order `collectTaggedTemplates`
 * returned them. This is important because the scanner uses the
 * result to detect custom scalars BEFORE parsing operations (second
 * review of the audit `2026-09-04 P1 #12`) — the top-down order is
 * what `customScalars` expects.
 *
 * If `templates` is empty, returns `[]`. If no template passes the
 * tag filter, returns `[]`. Never returns `null`.
 */
export function collectEmbeddedSdl(
  templates: ReadonlyArray<ITaggedTemplate>,
  options: ICollectEmbeddedSdlOptions = {},
): string[] {
  const tags = options.tags ?? DEFAULT_TAGS;
  const tagSet = new Set(tags);
  const out: string[] = [];
  for (const tpl of templates) {
    if (!tagSet.has(tpl.tag)) continue;
    out.push(tpl.raw);
  }
  return out;
}