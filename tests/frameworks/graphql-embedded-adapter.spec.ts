/**
 * Tests para el adapter AST → SDL embebido (a00015 S2).
 *
 * Cubre:
 *   - Positivo real: `gql\`...\`` → 1 SDL.
 *   - Positivo multi-tag: `gql` y `graphql` ambos se aceptan.
 *   - Negativo (comment / string): un `ITaggedTemplate` con el tag
 *     equivocado o sin tag → no se emite SDL.
 *   - Multi-uso: 5 `gql\`...\`` → 5 SDL strings en orden.
 *   - Tag filtering: `tags: ["graphql"]` excluye los `gql\``.
 */
import { describe, expect, test } from "vitest";

import { collectEmbeddedSdl } from "../../packages/frameworks/scanners/graphql-embedded.scanner";
import type { ITaggedTemplate } from "../../packages/frameworks/typescript/tagged-template.helper";

/** Helper: crea un ITaggedTemplate mínimo con `raw` y `tag`. */
function tpl(tag: string, raw: string): ITaggedTemplate {
  return {
    tag,
    raw,
    range: { start: 0, end: raw.length },
    sourceFile: "test.ts",
  };
}

describe("collectEmbeddedSdl — tag filter", () => {
  test("un gql`...` real se proyecta a SDL", () => {
    const sdl = `type Query { f: String }`;
    const out = collectEmbeddedSdl([tpl("gql", sdl)]);
    expect(out).toEqual([sdl]);
  });

  test("graphql`...` también se proyecta con la lista por defecto", () => {
    const sdl = `type Query { a: String }`;
    const out = collectEmbeddedSdl([tpl("graphql", sdl)]);
    expect(out).toEqual([sdl]);
  });

  test("un tag que NO está en la lista por defecto se descarta", () => {
    // Simula el caso de un comentario / string literal / template con
    // otro tag (`html`, `css`, etc.) — el adapter no los acepta.
    const out = collectEmbeddedSdl([tpl("html", "<div />")]);
    expect(out).toEqual([]);
  });

  test("template vacío (raw === '') pasa tal cual (el caller decide)", () => {
    // El adapter es **puro**: proyecta templates → SDL sin filtrar.
    // Un raw vacío no debería existir en un AST real (un
    // TaggedTemplateExpression sin caracteres entre los backticks
    // es legal pero raro). Si el caller lo ve, decide si lo pasa
    // al parser SDL — el adapter no toma esa decisión.
    const out = collectEmbeddedSdl([tpl("gql", "")]);
    expect(out).toEqual([""]);
  });

  test("tags custom: pasar ['graphql'] acepta solo graphql, no gql", () => {
    const a = `type Query { a: String }`;
    const b = `type Query { b: String }`;
    const out = collectEmbeddedSdl(
      [tpl("gql", a), tpl("graphql", b)],
      { tags: ["graphql"] },
    );
    expect(out).toEqual([b]);
  });

  test("tags custom: pasar ['gql', 'css'] acepta ambos", () => {
    const a = `type Query { a: String }`;
    const css = `.button { color: red; }`;
    const out = collectEmbeddedSdl(
      [tpl("gql", a), tpl("css", css)],
      { tags: ["gql", "css"] },
    );
    expect(out).toEqual([a, css]);
  });
});

describe("collectEmbeddedSdl — orden y multi-uso", () => {
  test("cinco gql`...` → cinco SDL en el orden de entrada", () => {
    const out = collectEmbeddedSdl([
      tpl("gql", "type Query { a: String }"),
      tpl("gql", "type Query { b: String }"),
      tpl("gql", "type Query { c: String }"),
      tpl("gql", "type Query { d: String }"),
      tpl("gql", "type Query { e: String }"),
    ]);
    expect(out).toHaveLength(5);
    // Orden top-down: la letra crece.
    const letters = out.map((s) => s.match(/\{ ([a-z]):/)?.[1] ?? "");
    expect(letters).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("mezcla de tags: gql sale, html se descarta, graphql sale", () => {
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

  test("input vacío → []", () => {
    expect(collectEmbeddedSdl([])).toEqual([]);
  });
});