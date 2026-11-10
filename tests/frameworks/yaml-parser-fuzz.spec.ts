/**
 * The YAML parser against inputs nobody wrote by hand.
 *
 * `parseYamlLite` is 267 lines without dependencies —the compiled
 * binary cannot load packages at runtime— and reads OpenAPI specs
 * **written by others**: uncontrolled input, from the framework with
 * the most measured endpoints in the project.
 *
 * It was hit with weird inputs before this was written, and the good
 * news is that **it never throws and never hangs**. The bad news is
 * that very same robustness makes it dangerous: a spec it cannot
 * read is indistinguishable from an empty one. `a: &x 1` returns the
 * string `"&x 1"` instead of the number, and nobody finds out until
 * the collection carries values that are not the spec's.
 *
 * Anchors are not exotic in OpenAPI: they are how a single error
 * response is shared across twenty endpoints without copy-paste.
 *
 * Hence the two halves of this file: the **invariants**, which hold
 * for any input, and the **detection**, which separates "I do not
 * support this" from "I lied to you".
 */
import { describe, expect, test } from "vitest";

import { parseYamlLite, unsupportedYamlFeatures } from "../../packages/frameworks/scanners/openapi.scanner";

/** Pieces used to build random documents. */
const PIEZAS = [
  "a: 1",
  "b: texto",
  "c: true",
  "d: null",
  "  anidado: 1",
  "\tcon-tabulador: 1",
  "- item",
  "  - item anidado",
  "e: |",
  "f: >",
  "# comentario",
  "",
  "   ",
  "g: 'comilla simple",
  'h: "sin cerrar',
  "i: http://x.com:8080/y",
  ": sin clave",
  "j:",
  "k: &ancla 1",
  "l: *ancla",
  "<<: *base",
  "---",
  "m: [1, 2, 3]",
  "n: { x: 1 }",
  "ñ: acentos y ünïcode",
  "o: 0x1F",
  'p: "\\u0000"',
];

/** A reproducible generator: a failure can be reproduced. */
function aleatorio(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function documento(rnd: () => number, lineas: number): string {
  return Array.from(
    { length: lineas },
    () => PIEZAS[Math.floor(rnd() * PIEZAS.length)] ?? "",
  ).join("\n");
}

describe("invariants: hold for any input", () => {
  /**
   * THE test. 500 documents generated from a mix of legal and illegal
   * pieces. If any of them throws or hangs, the OpenAPI scanner takes
   * the entire generation of a project down with it.
   */
  test("never throws, across 500 generated documents", () => {
    const rnd = aleatorio(20260808);
    const fallos: string[] = [];
    for (let i = 0; i < 500; i++) {
      const src = documento(rnd, 1 + Math.floor(rnd() * 25));
      try {
        parseYamlLite(src);
      } catch (error) {
        fallos.push(`${(error as Error).message}\n--- entrada ---\n${src}`);
      }
    }
    expect(fallos, fallos[0] ?? "").toEqual([]);
  });

  test("finishes: 200 long documents in under five seconds", () => {
    const rnd = aleatorio(1234);
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) parseYamlLite(documento(rnd, 200));
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  test("absurd nesting does not blow the stack", () => {
    const profundo = Array.from({ length: 500 }, (_, i) => `${" ".repeat(i)}k${i}:`).join("\n");
    expect(() => parseYamlLite(profundo)).not.toThrow();
  });

  test("always returns something, never `undefined`", () => {
    const rnd = aleatorio(77);
    for (let i = 0; i < 100; i++) {
      expect(parseYamlLite(documento(rnd, 10))).toBeDefined();
    }
  });

  test.for([
    ["empty", ""],
    ["solo espacios", "   \n  \n"],
    ["only comments", "# nada\n# aquí"],
    ["con BOM", "﻿a: 1"],
    ["truncado a media clave", "paths:\n  /users:\n    get"],
  ] as const)("%s does not break", ([, src]) => {
    expect(() => parseYamlLite(src)).not.toThrow();
  });

  test("what it parses well, it parses well", () => {
    const spec = parseYamlLite(
      ["openapi: 3.0.0", "paths:", "  /users:", "    get:", "      summary: Listar"].join("\n"),
    ) as { openapi?: string; paths?: Record<string, Record<string, { summary?: string }>> };
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.paths?.["/users"]?.["get"]?.summary).toBe("Listar");
  });
});

describe("detection: what it cannot read, it says so", () => {
  test.for([
    ["anchors", "responses: &shared\n  '200': {}", "anchors"],
    ["alias", "responses: *shared", "alias"],
    ["merge keys", "<<: *base", "merge keys"],
  ] as const)("warns about %s", ([, src, esperado]) => {
    const encontrado = unsupportedYamlFeatures(src);
    expect(encontrado.length).toBeGreaterThan(0);
    expect(encontrado.join(" ")).toContain(esperado);
  });

  test("multiple documents in one file", () => {
    expect(unsupportedYamlFeatures("---\na: 1\n---\nb: 2\n").length).toBeGreaterThan(0);
  });

  /**
   * The symmetric failure, and the one that really protects us: if
   * it warned too much, every normal spec would come out with a
   * warning and nobody would read them.
   */
  test("a normal spec triggers no warning", () => {
    const normal = [
      "openapi: 3.0.0",
      "info:",
      "  title: API",
      "paths:",
      "  /users/{id}:",
      "    get:",
      "      operationId: getUser",
      "      responses:",
      "        '200':",
      "          description: ok",
      "  /search:",
      "    get:",
      "      parameters:",
      "        - name: q",
      "          in: query",
    ].join("\n");
    expect(unsupportedYamlFeatures(normal)).toEqual([]);
  });

  test("a URL containing `*` or `&` in a value is not an anchor", () => {
    expect(unsupportedYamlFeatures("url: http://x.com/?a=1&b=2")).toEqual([]);
  });

  /**
   * This documents the concrete damage, and is why the warning
   * exists: the parser does not fail, it returns the literal string.
   */
  test("without the warning, an anchor sneaks through as text", () => {
    const conAncla = parseYamlLite("a: &x 1\nb: *x") as Record<string, unknown>;
    expect(conAncla["a"]).toBe("&x 1");
    expect(conAncla["b"]).toBe("*x");
    // And that is why we must warn.
    expect(unsupportedYamlFeatures("a: &x 1\nb: *x").length).toBe(2);
  });
});
