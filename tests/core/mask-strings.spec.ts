/**
 * Telling code apart from text inside code.
 *
 * This is the question the scanners were asking without knowing it:
 * *is this call really there, or is it inside a string?* A file with
 *
 *     const ayuda = 'usa router.get("/x") para registrar';
 *
 * produced a `GET /x` endpoint that did not exist anywhere.
 *
 * And the half that is easy to forget: the path of a **real** route is
 * also a string. Searching in the mask and reading from it would yield
 * empty routes, and the failure would be silent — routes would be
 * dropped one by one without anything noticing.
 */
import { describe, expect, test } from "vitest";

import { findOutsideStrings, maskStringLiterals } from "../../packages/core/helpers/source-scan.helper";

describe("maskStringLiterals", () => {
  // The length is preserved so the mask offsets still apply to the
  // original. Without that you would need a position map, which is the
  // kind of thing that drifts out of sync.
  test("preserves the exact length", () => {
    for (const src of [
      `const a = "hola";`,
      `const a = 'con \\'escape\\' dentro';`,
      "const a = `plantilla ${x} y más`;",
      `const a = "sin cerrar`,
    ]) {
      expect(maskStringLiterals(src).length, src).toBe(src.length);
    }
  });

  test("empties the content but keeps the quotes", () => {
    expect(maskStringLiterals(`x = "abc"`)).toBe(`x = "   "`);
    expect(maskStringLiterals(`x = 'abc'`)).toBe(`x = '   '`);
  });

  test("the code outside is not touched", () => {
    expect(maskStringLiterals(`router.get("/x")`)).toBe(`router.get("  ")`);
  });

  // Without handling the escape, a `"\\""` closes where it should not
  // and from there onward real code gets masked.
  test("an escaped quote does not close the string", () => {
    const masked = maskStringLiterals(`x = "a\\"b"; router.get("/y")`);
    expect(masked).toContain("router.get(");
  });

  /**
   * What goes into `${…}` of a template **is** code: that is where
   * interpolations live that other lints have to see.
   */
  test("the interpolation of a template is preserved", () => {
    expect(maskStringLiterals("`a ${nombre} b`")).toContain("${nombre}");
  });

  // If a quote is left open it was not a string; masking to the end
  // would eat the rest of the file.
  test("a stray quote does not eat the rest of the file", () => {
    const src = `const a = "sin cerrar\nrouter.get("/y")`;
    expect(maskStringLiterals(src)).toContain("router.get(");
  });
});

describe("findOutsideStrings", () => {
  const ROUTE = /(\w+)\s*\.\s*(get|post)\s*\(\s*(['"])([^'"\n]+)\3/gi;

  test("finds a normal call", () => {
    const found = findOutsideStrings(`router.get("/users", h);`, ROUTE);
    expect(found).toHaveLength(1);
    expect(found[0]?.match[4]).toBe("/users");
  });

  // The second half of the trick: the path of a real route IS a string,
  // so it has to be read from the original and not from the blank mask.
  test("the path is read from the original, not from the blank mask", () => {
    const found = findOutsideStrings(`router.post("/orders", h);`, ROUTE);
    expect(found[0]?.match[4]).toBe("/orders");
    expect(found[0]?.match[4]).not.toMatch(/^\s+$/);
  });

  test("discards the call that lives inside a string", () => {
    const src = `const ayuda = 'usa router.get("/falsa") para registrar';`;
    expect(findOutsideStrings(src, ROUTE)).toEqual([]);
  });

  test("with both at once, only the real one is counted", () => {
    const src = [
      `const ayuda = 'usa router.get("/falsa")';`,
      `router.get("/real", h);`,
    ].join("\n");
    const found = findOutsideStrings(src, ROUTE);
    expect(found).toHaveLength(1);
    expect(found[0]?.match[4]).toBe("/real");
  });

  /**
   * `router.post(\n  "/x",\n  handler,\n)` is the normal shape as soon
   * as there are middlewares, and a per-line loop misses the path
   * because it sits on a different line from the call.
   */
  test("crosses line breaks", () => {
    const src = `router.post(\n  "/multilinea",\n  validate(schema),\n  handler,\n);`;
    const found = findOutsideStrings(src, ROUTE);
    expect(found[0]?.match[4]).toBe("/multilinea");
  });

  test("comments are discarded before searching", () => {
    const src = [
      `// router.get("/comentada");`,
      `/* router.post("/bloque"); */`,
      `router.get("/real");`,
    ].join("\n");
    const found = findOutsideStrings(src, ROUTE);
    expect(found.map((f) => f.match[4])).toEqual(["/real"]);
  });

  test("the index points to the real location", () => {
    const src = `\n\nrouter.get("/x");`;
    expect(findOutsideStrings(src, ROUTE)[0]?.index).toBe(2);
  });

  // The regex that is passed in is not touched: moving its `lastIndex`
  // would break the caller's loop (see `lint:regex-state`).
  test("does not mutate the regex it receives", () => {
    ROUTE.lastIndex = 0;
    findOutsideStrings(`router.get("/a"); router.get("/b");`, ROUTE);
    expect(ROUTE.lastIndex).toBe(0);
  });

  test("with no matches returns empty", () => {
    expect(findOutsideStrings(`const x = 1;`, ROUTE)).toEqual([]);
  });
});
