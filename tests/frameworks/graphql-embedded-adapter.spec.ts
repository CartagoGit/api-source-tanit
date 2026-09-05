/**
 * Tests for the AST → embedded SDL adapter (a00015 S2).
 *
 * Covers:
 *   - Real positive: `gql\`...\`` → 1 SDL.
 *   - Multi-tag positive: both `gql` and `graphql` are accepted.
 *   - Negative (comment / string): an `ITaggedTemplate` with the
 *     wrong tag or no tag → no SDL is emitted.
 *   - Multi-use: 5 `gql\`...\`` → 5 SDL strings in order.
 *   - Tag filtering: `tags: ["graphql"]` excludes the `gql\``.
 */
import { describe, expect, test } from "vitest";

import { collectEmbeddedSdl } from "../../packages/frameworks/scanners/graphql-embedded.scanner";
import type { IParseDiagnostic } from "../../packages/contracts/interfaces/core/scanner.interface";
import type { ITaggedTemplate } from "../../packages/frameworks/typescript/tagged-template.helper";

/** Helper: builds a minimal ITaggedTemplate with `raw` and `tag`. */
function tpl(tag: string, raw: string): ITaggedTemplate {
  return {
    tag,
    raw,
    range: { start: 0, end: raw.length },
    sourceFile: "test.ts",
  };
}

describe("collectEmbeddedSdl — tag filter", () => {
  test("a real gql`...` is projected to SDL", () => {
    const sdl = `type Query { f: String }`;
    const out = collectEmbeddedSdl([tpl("gql", sdl)]);
    expect(out).toEqual([sdl]);
  });

  test("graphql`...` is also projected with the default list", () => {
    const sdl = `type Query { a: String }`;
    const out = collectEmbeddedSdl([tpl("graphql", sdl)]);
    expect(out).toEqual([sdl]);
  });

  test("a tag NOT in the default list is discarded", () => {
    // Simulates the case of a comment / string literal / template with
    // another tag (`html`, `css`, etc.) — the adapter does not accept them.
    const out = collectEmbeddedSdl([tpl("html", "<div />")]);
    expect(out).toEqual([]);
  });

  test("empty template (raw === '') is passed as-is (caller decides)", () => {
    // The adapter is **pure**: it projects templates → SDL without
    // filtering. An empty raw should not exist in a real AST (a
    // TaggedTemplateExpression with no characters between the
    // backticks is legal but rare). If the caller sees one, they
    // decide whether to pass it to the SDL parser — the adapter does
    // not make that call.
    const out = collectEmbeddedSdl([tpl("gql", "")]);
    expect(out).toEqual([""]);
  });

  test("custom tags: passing ['graphql'] accepts only graphql, not gql", () => {
    const a = `type Query { a: String }`;
    const b = `type Query { b: String }`;
    const out = collectEmbeddedSdl(
      [tpl("gql", a), tpl("graphql", b)],
      { tags: ["graphql"] },
    );
    expect(out).toEqual([b]);
  });

  test("custom tags: passing ['gql', 'css'] accepts both", () => {
    const a = `type Query { a: String }`;
    const css = `.button { color: red; }`;
    const out = collectEmbeddedSdl(
      [tpl("gql", a), tpl("css", css)],
      { tags: ["gql", "css"] },
    );
    expect(out).toEqual([a, css]);
  });
});

describe("collectEmbeddedSdl — order and multi-use", () => {
  test("five gql`...` → five SDL entries in input order", () => {
    const out = collectEmbeddedSdl([
      tpl("gql", "type Query { a: String }"),
      tpl("gql", "type Query { b: String }"),
      tpl("gql", "type Query { c: String }"),
      tpl("gql", "type Query { d: String }"),
      tpl("gql", "type Query { e: String }"),
    ]);
    expect(out).toHaveLength(5);
    // Top-down order: the letter grows.
    const letters = out.map((s) => s.match(/\{ ([a-z]):/)?.[1] ?? "");
    expect(letters).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("tag mix: gql goes through, html is discarded, graphql goes through", () => {
    const out = collectEmbeddedSdl([
      tpl("gql", "type Query { a: String }"),
      tpl("html", "<div />"),
      tpl("graphql", "type Query { b: String }"),
    ]);
    expect(out).toEqual([
      "type Query { a: String }",
      "type Query { b: String }",
    ]);
  });

  test("empty input → []", () => {
    expect(collectEmbeddedSdl([])).toEqual([]);
  });
});
// a00015 S4: un template con interpolaciones lleva hasInterpolation y el
// adapter lo omite + deja un warning en diagnostics (no se traga un SDL
// incompleto, ni pierde el ${...} en silencio).
describe("collectEmbeddedSdl - interpolaciones (a00015 S4)", () => {
  function tplInterp(tag: string, raw: string): ITaggedTemplate {
    return { tag, raw, range: { start: 0, end: raw.length }, sourceFile: "test.ts", hasInterpolation: true };
  }

  test("template con interpolacion se omite del SDL", () => {
    const out = collectEmbeddedSdl([tplInterp("gql", "type Query { a: String } __TANIT_INTERP_0__")]);
    expect(out).toEqual([]);
  });

  test("template con interpolacion deja warning en diagnostics", () => {
    const diagnostics: IParseDiagnostic[] = [];
    collectEmbeddedSdl([tplInterp("gql", "x __TANIT_INTERP_0__")], { diagnostics });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(diagnostics[0]?.reason).toMatch(/interpolaci/i);
    expect(diagnostics[0]?.file).toBe("test.ts");
  });

  test("template sin interpolacion se incluye, sin diagnostic", () => {
    const diagnostics: IParseDiagnostic[] = [];
    const out = collectEmbeddedSdl([tpl("gql", "type Q { a: String }")], { diagnostics });
    expect(out).toEqual(["type Q { a: String }"]);
    expect(diagnostics).toHaveLength(0);
  });
});
