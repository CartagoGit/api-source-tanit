/**
 * Tests for `collectConstantsFromSource` (a00016 S6).
 *
 * Verifies that the helper extracts every top-level
 * `const X = <literal>` binding in a TS file. The scanner passes
 * the result to `propagateConstants` to resolve `app[M](...)` into
 * `app.get(...)` — without this slice, the scanner was forced to
 * pass `[]` and the "const M = 'get'" style was unreachable E2E
 * (unit tests fabricated bindings by hand).
 */
import { describe, expect, it } from "vitest";
import { collectConstantsFromSource } from "../../packages/frameworks/typescript/collect-constants.helper.js";

const FILE = "src/server.ts";

describe("collectConstantsFromSource (a00016 S6)", () => {
  it("extracts a string const", () => {
    const src = `
      const METHOD = "get";
      app[METHOD]("/x", h);
    `;
    const out = collectConstantsFromSource(src, FILE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "METHOD", value: "get" });
    expect(out[0]?.range.file).toBe(FILE);
  });

  it("extracts a numeric const", () => {
    const out = collectConstantsFromSource(
      `const LIMIT = 42;`,
      FILE,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("LIMIT");
    expect(out[0]?.value).toBe(42);
  });

  it("extracts a boolean const", () => {
    const out = collectConstantsFromSource(
      `const ENABLED = true;`,
      FILE,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("ENABLED");
    expect(out[0]?.value).toBe(true);
  });

  it("extracts multiple bindings", () => {
    const src = `
      const GET = "get";
      const POST = "post";
      const N = 3;
    `;
    const out = collectConstantsFromSource(src, FILE);
    expect(out).toHaveLength(3);
    const names = out.map((b) => b.name).sort();
    expect(names).toEqual(["GET", "N", "POST"]);
  });

  it("ignores non-literal initializers (function calls, arithmetic)", () => {
    const src = `
      const FN = someFactory();
      const COMPUTED = 1 + 2;
      const ARR = ["a", "b"];
      const OBJ = { a: 1 };
    `;
    const out = collectConstantsFromSource(src, FILE);
    expect(out).toHaveLength(0);
  });

  it("unwraps TS `as const`", () => {
    const out = collectConstantsFromSource(
      `const METHOD = "get" as const;`,
      FILE,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.value).toBe("get");
  });

  it("returns [] on parse failure", () => {
    const out = collectConstantsFromSource(`{{{`, FILE);
    expect(out).toEqual([]);
  });

  it("ignores `let`/`var` (S6 only covers `const`)", () => {
    const out = collectConstantsFromSource(
      `let X = "x"; var Y = "y";`,
      FILE,
    );
    expect(out).toEqual([]);
  });
});
