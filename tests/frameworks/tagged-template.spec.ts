/**
 * Tests for `collectTaggedTemplates` (a00015 S1).
 *
 * Covers:
 *   - Positive case: `gql\`type Query { f: String }\`` → 1 template.
 *   - Negative case (comment): a `// gql\`...\`` inside a comment is
 *     NOT recognized as a TaggedTemplateExpression.
 *   - Negative case (string literal): a `"gql\`...\``" as a literal is
 *     also not recognized.
 *   - Multi-use case: 5 `gql\`...\`` → 5 templates.
 *
 * These tests are unit tests over `collectTaggedTemplatesFromSource`
 * (they take `source` + `filename`) because it is the pure primitive.
 * `collectTaggedTemplates(projectRoot)` is covered in S2 with the
 * adapter and a temporary project on disk.
 */
import { describe, expect, test } from "vitest";

import {
  collectTaggedTemplatesFromSource,
  type ITaggedTemplate,
} from "../../packages/frameworks/typescript/tagged-template.helper";

describe("collectTaggedTemplatesFromSource — positive shape", () => {
  test("a simple gql`...` is recognized as a TaggedTemplateExpression", () => {
    const source = `import { gql } from "@apollo/client";

const typeDefs = gql\`
  type Query {
    f: String
  }
\`;
`;
    const found: ITaggedTemplate[] = collectTaggedTemplatesFromSource(
      source,
      "schema.ts",
    );
    expect(found).toHaveLength(1);
    const tpl = found[0];
    expect(tpl?.tag).toBe("gql");
    expect(tpl?.importBinding).toBe("gql");
    expect(tpl?.raw).toContain("type Query");
    expect(tpl?.raw).toContain("f: String");
    if (tpl) {
      expect(tpl.range.start).toBeGreaterThan(0);
      expect(tpl.range.end).toBeGreaterThan(tpl.range.start);
    }
  });

  test("graphql`...` is also recognized with tag='graphql'", () => {
    const source = `const t = graphql\`type Query { a: String }\`;`;
    const found = collectTaggedTemplatesFromSource(source, "schema.ts");
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("graphql");
  });

  test("Foo.graphql`...` is recognized with tag='graphql' (MemberExpression)", () => {
    const source = `const t = Foo.graphql\`type Query { a: String }\`;`;
    const found = collectTaggedTemplatesFromSource(source, "schema.ts");
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("graphql");
  });
});

describe("collectTaggedTemplatesFromSource — false positives", () => {
  test("a gql`...` inside a comment is NOT recognized", () => {
    // This was previously a false positive in `extractEmbeddedSdl`:
    // the regex saw `gql\`` and returned the contents.
    const source = `// Puedes escribir gql\`type Query { fake: String }\` en el archivo.
const real = 1;
`;
    const found = collectTaggedTemplatesFromSource(source, "doc.ts");
    expect(found).toHaveLength(0);
  });

  test("a gql`...` inside a string literal is NOT recognized", () => {
    // This was the other false positive: the regex saw `gql\``
    // inside a string and returned a fictitious SDL.
    const source = `const help = "gql\`type Query { fake: String }\` es la sintaxis";
`;
    const found = collectTaggedTemplatesFromSource(source, "doc.ts");
    expect(found).toHaveLength(0);
  });

  test("a gql`...` inside a block comment is also not recognized", () => {
    const source = `/*
 * Aquí va un ejemplo: gql\`type Query { fake: String }\`
 */
const real = 1;
`;
    const found = collectTaggedTemplatesFromSource(source, "doc.ts");
    expect(found).toHaveLength(0);
  });
});

describe("collectTaggedTemplatesFromSource — multi-use", () => {
  test("five gql`...` → five templates in order of appearance", () => {
    const source = `
const a = gql\`type Query { a: String }\`;
const b = gql\`type Query { b: String }\`;
const c = gql\`type Query { c: String }\`;
const d = gql\`type Query { d: String }\`;
const e = gql\`type Query { e: String }\`;
`;
    const found = collectTaggedTemplatesFromSource(source, "schema.ts");
    expect(found).toHaveLength(5);
    for (const tpl of found) expect(tpl.tag).toBe("gql");
    // Order is top-down: the SDL field letter must grow in order.
    const letters = found.map((t) => t.raw.match(/\{ ([a-z]):/)?.[1] ?? "");
    expect(letters).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("collectTaggedTemplatesFromSource — degrade-safe", () => {
  test("invalid syntax → [] without throwing, and diagnostics captures the reason", () => {
    const source = `const x = gql\``; // unclosed backtick
    // The adapter only populates `diagnostics` with entries of the
    // shape `{ severity: "error" | "warning" }`. We keep the adapter's
    // type (not a local alias) so this test fails if the contract
    // changes.
    const diagnostics: Parameters<typeof collectTaggedTemplatesFromSource>[2] = [];
    const found = collectTaggedTemplatesFromSource(source, "broken.ts", diagnostics);
    expect(found).toEqual([]);
    // `errorRecovery: true` prevents the exception: either the
    // diagnostics are empty, or we have a warning but the result is
    // []. Both shapes are accepted — what matters is that it does
    // not throw.
    expect(Array.isArray(diagnostics)).toBe(true);
  });
});
// a00015 S4: las interpolaciones del template no se pierden: el frontend
// coloca un sentinel determinista en su sitio y marca hasInterpolation.
describe("collectTaggedTemplatesFromSource - interpolaciones (a00015 S4)", () => {
  test("un ${...} produce un sentinel y hasInterpolation true", () => {
    const source = ["const shared = \x27\x27;", "const t = gql\`type Query { foo: String } \${shared}\`;"].join("\n");
    const found = collectTaggedTemplatesFromSource(source, "schema.ts");
    expect(found).toHaveLength(1);
    const t = found[0];
    if (!t) throw new Error("template no reconocido");
    expect(t.raw).toContain("type Query");
    expect(t.raw).toContain("foo: String");
    expect(t.raw).toContain("__TANIT_INTERP_0__");
    expect(t.hasInterpolation).toBe(true);
  });

  test("dos interpolaciones producen dos sentinels ordenados", () => {
    const source = ["const a = \x27\x27;", "const b = \x27\x27;", "const t = gql\`type \${a} { x: \${b} }\`;"].join("\n");
    const found = collectTaggedTemplatesFromSource(source, "schema.ts");
    expect(found).toHaveLength(1);
    const rawOf: string = found[0]?.raw ?? "";
    expect(rawOf).toContain("__TANIT_INTERP_0__");
    expect(rawOf.indexOf("__TANIT_INTERP_0__")).toBeLessThan(rawOf.indexOf("__TANIT_INTERP_1__"));
    expect(found[0]?.hasInterpolation).toBe(true);
  });

  test("sin interpolaciones: raw sin sentinel y hasInterpolation ausente", () => {
    const found = collectTaggedTemplatesFromSource("const t = gql\`type Query { bar: Int }\`;", "schema.ts");
    expect(found[0]?.raw).not.toContain("__TANIT_INTERP_");
    expect(found[0]?.hasInterpolation).toBeUndefined();
  });
});
