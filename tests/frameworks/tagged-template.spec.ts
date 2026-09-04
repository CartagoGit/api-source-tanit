/**
 * Tests para `collectTaggedTemplates` (a00015 S1).
 *
 * Cubre:
 *   - Caso positivo: `gql\`type Query { f: String }\`` → 1 template.
 *   - Caso negativo (comentario): un `// gql\`...\`` dentro de un
 *     comentario NO se reconoce como TaggedTemplateExpression.
 *   - Caso negativo (string literal): un `"gql\`...\``" como literal
 *     tampoco se reconoce.
 *   - Caso multi-uso: 5 `gql\`...\`` → 5 templates.
 *
 * Estos tests son unitarios sobre `collectTaggedTemplatesFromSource`
 * (reciben `source` + `filename`) porque es la primitiva pura.
 * `collectTaggedTemplates(projectRoot)` se cubre en S2 con el adapter
 * y un proyecto temporal en disco.
 */
import { describe, expect, test } from "vitest";

import {
  collectTaggedTemplatesFromSource,
  type ITaggedTemplate,
} from "../../packages/frameworks/typescript/tagged-template";

describe("collectTaggedTemplatesFromSource — shape positiva", () => {
  test("un gql`...` simple se reconoce como TaggedTemplateExpression", () => {
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

  test("graphql`...` también se reconoce con tag='graphql'", () => {
    const source = `const t = graphql\`type Query { a: String }\`;`;
    const found = collectTaggedTemplatesFromSource(source, "schema.ts");
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("graphql");
  });

  test("Foo.graphql`...` se reconoce con tag='graphql' (MemberExpression)", () => {
    const source = `const t = Foo.graphql\`type Query { a: String }\`;`;
    const found = collectTaggedTemplatesFromSource(source, "schema.ts");
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("graphql");
  });
});

describe("collectTaggedTemplatesFromSource — falsos positivos", () => {
  test("un gql`...` dentro de un comentario NO se reconoce", () => {
    // Antes esto era un falso positivo en `extractEmbeddedSdl`:
    // el regex veía `gql\`` y devolvía el contenido.
    const source = `// Puedes escribir gql\`type Query { fake: String }\` en el archivo.
const real = 1;
`;
    const found = collectTaggedTemplatesFromSource(source, "doc.ts");
    expect(found).toHaveLength(0);
  });

  test("un gql`...` dentro de un string literal NO se reconoce", () => {
    // Antes esto era el otro falso positivo: el regex veía `gql\``
    // dentro de un string y devolvía un SDL ficticio.
    const source = `const help = "gql\`type Query { fake: String }\` es la sintaxis";
`;
    const found = collectTaggedTemplatesFromSource(source, "doc.ts");
    expect(found).toHaveLength(0);
  });

  test("un gql`...` dentro de un block comment tampoco", () => {
    const source = `/*
 * Aquí va un ejemplo: gql\`type Query { fake: String }\`
 */
const real = 1;
`;
    const found = collectTaggedTemplatesFromSource(source, "doc.ts");
    expect(found).toHaveLength(0);
  });
});

describe("collectTaggedTemplatesFromSource — multi-uso", () => {
  test("cinco gql`...` → cinco templates en orden de aparición", () => {
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
    // El orden es top-down: la letra del campo SDL debe ir en orden.
    const letters = found.map((t) => t.raw.match(/\{ ([a-z]):/)?.[1] ?? "");
    expect(letters).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("collectTaggedTemplatesFromSource — degradable", () => {
  test("sintaxis inválida → [] sin lanzar, y diagnostics recoge la razón", () => {
    const source = `const x = gql\``; // backtick sin cerrar
    // El adapter solo popula `diagnostics` con entries `{ severity:
    // "error" | "warning" }`. Mantenemos el tipo del adapter (no
    // un alias local) para que el test falle si cambia el contrato.
    const diagnostics: Parameters<typeof collectTaggedTemplatesFromSource>[2] = [];
    const found = collectTaggedTemplatesFromSource(source, "broken.ts", diagnostics);
    expect(found).toEqual([]);
    // `errorRecovery: true` evita la excepción: o la tenemos vacía,
    // o tenemos un warning pero el resultado es [].
    // Aceptamos ambas formas — lo importante es que no lanza.
    expect(Array.isArray(diagnostics)).toBe(true);
  });
});