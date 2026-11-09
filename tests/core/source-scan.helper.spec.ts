import { describe, expect, test } from "vitest";
import { countLinesBefore, findAllBalanced, findClosingParen, findNearestBalanced, splitTopLevel, stripJsComments, unwrapObjectLiteralItem } from "../../packages/core/helpers/source-scan.helper";

describe("stripJsComments", () => {
  test("removes block comments", () => {
    expect(stripJsComments("a /* fuera */ b")).toBe("a  b");
  });

  test("removes line comments", () => {
    expect(stripJsComments("const a = 1; // fuera\nconst b = 2;")).toBe(
      "const a = 1; \nconst b = 2;",
    );
  });

  test("does not break URLs with https://", () => {
    expect(stripJsComments('const u = "https://api.example.com/users";')).toContain(
      "https://api.example.com/users",
    );
  });

  test("a commented-out endpoint does not survive the strip", () => {
    const src = ["app.get('/live', h);", "// app.get('/muerto', h);"].join("\n");
    expect(stripJsComments(src)).not.toContain("/muerto");
    expect(stripJsComments(src)).toContain("/live");
  });
});

describe("findClosingParen", () => {
  test("finds the closing paren respecting nesting", () => {
    const text = "f(a, g(b), c)";
    expect(findClosingParen(text, 1)).toBe(text.length - 1);
  });

  test("returns -1 if it never closes", () => {
    expect(findClosingParen("f(a, b", 1)).toBe(-1);
  });
});

describe("findAllBalanced", () => {
  test("finds all the calls and their bounds", () => {
    const text = "z.object({ a: 1 }) y z.object({ b: 2 })";
    const calls = findAllBalanced(text, /z\.object\s*\(/);
    expect(calls).toHaveLength(2);
    expect(text.slice(calls[0]!.callStart + 1, calls[0]!.callEnd)).toBe("{ a: 1 }");
    expect(text.slice(calls[1]!.callStart + 1, calls[1]!.callEnd)).toBe("{ b: 2 }");
  });

  test("respects nested parentheses inside the call", () => {
    const text = "z.object({ a: z.string().min(1) })";
    const calls = findAllBalanced(text, /z\.object\s*\(/);
    expect(text.slice(calls[0]!.callStart + 1, calls[0]!.callEnd)).toBe(
      "{ a: z.string().min(1) }",
    );
  });

  test("discards unclosed calls", () => {
    expect(findAllBalanced("z.object({ a: 1 }", /z\.object\s*\(/)).toHaveLength(0);
  });

  // Regression: the copy that lived in nextjs.scanner.ts iterated
  // with `exec()` over a regex WITHOUT the `g` flag, so `lastIndex`
  // never advanced and the scan of any Next.js project with a
  // `z.object(` hung the process indefinitely.
  test("terminates even when the pattern is passed without the global flag", () => {
    const text = "z.object({ a: 1 }) z.object({ b: 2 }) z.object({ c: 3 })";
    const nonGlobal = /z\.object\s*\(/;
    expect(nonGlobal.global).toBe(false);
    expect(findAllBalanced(text, nonGlobal)).toHaveLength(3);
  });

  test("also accepts a pattern that already has the global flag", () => {
    const text = "z.object({ a: 1 }) z.object({ b: 2 })";
    expect(findAllBalanced(text, /z\.object\s*\(/g)).toHaveLength(2);
  });
});

describe("findNearestBalanced", () => {
  const text = [
    "const above = z.object({ a: 1 });", // line 0
    "",
    "",
    "function handler() {}", // line 3
    "",
    "const below = z.object({ b: 2 });", // line 5
  ].join("\n");

  test("picks the nearest schema above", () => {
    const call = findNearestBalanced(text, /z\.object\s*\(/, 2);
    expect(text.slice(call!.callStart + 1, call!.callEnd)).toBe("{ a: 1 }");
  });

  test("picks the nearest schema below", () => {
    const call = findNearestBalanced(text, /z\.object\s*\(/, 5);
    expect(text.slice(call!.callStart + 1, call!.callEnd)).toBe("{ b: 2 }");
  });

  test("returns null if there is no match", () => {
    expect(findNearestBalanced("sin schemas", /z\.object\s*\(/, 0)).toBeNull();
  });
});

describe("countLinesBefore", () => {
  test("counts line breaks before the index", () => {
    const text = "a\nb\nc";
    expect(countLinesBefore(text, 0)).toBe(0);
    expect(countLinesBefore(text, 2)).toBe(1);
    expect(countLinesBefore(text, 4)).toBe(2);
  });
});

describe("splitTopLevel", () => {
  test("splits on top-level commas", () => {
    expect(splitTopLevel("{ a: 1, b: 2 }")).toEqual(["{ a: 1", "b: 2 }"]);
  });

  test("ignores commas inside nested objects", () => {
    const items = splitTopLevel("{ a: z.enum(['x', 'y']), b: 2 }");
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("z.enum(['x', 'y'])");
  });

  test("ignores commas inside strings", () => {
    const items = splitTopLevel(`{ a: "uno,dos", b: 2 }`);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("uno,dos");
  });

  test("respects escapes inside strings", () => {
    const items = splitTopLevel(`{ a: "con \\" comilla, y coma", b: 2 }`);
    expect(items).toHaveLength(2);
  });

  test("supports template literals", () => {
    const items = splitTopLevel("{ a: `uno,dos`, b: 2 }");
    expect(items).toHaveLength(2);
  });
});

describe("unwrapObjectLiteralItem", () => {
  test("strips the opening brace from the first item", () => {
    expect(unwrapObjectLiteralItem("{ a: 1")).toBe("a: 1");
  });

  test("strips the closing brace from the last item", () => {
    expect(unwrapObjectLiteralItem("b: 2 }")).toBe("b: 2");
  });

  test("leaves a middle item intact", () => {
    expect(unwrapObjectLiteralItem("  b: 2  ")).toBe("b: 2");
  });
});

describe("splitTopLevel — with and without outer braces", () => {
  // The contract was fixed at "depth 1", which only worked when the
  // outer braces were passed in — and without saying so anywhere.
  // Passing the bare body silently returned ONE item with everything
  // inside. The Hono scanner worked that way for a while, extracting
  // one field out of four.
  test("with outer braces separates the fields", () => {
    expect(splitTopLevel("{ a: 1, b: 2 }")).toHaveLength(2);
  });

  test("without outer braces also separates them", () => {
    expect(splitTopLevel("a: 1, b: 2")).toHaveLength(2);
  });

  test("with outer brackets also separates them", () => {
    expect(splitTopLevel("[1, 2, 3]")).toHaveLength(3);
  });

  test("does not split on a nested comma", () => {
    expect(splitTopLevel("a: f(1, 2), b: 3")).toEqual(["a: f(1, 2)", "b: 3"]);
  });

  test("does not split on a comma inside a string", () => {
    expect(splitTopLevel(`a: "x, y", b: 2`)).toEqual([`a: "x, y"`, "b: 2"]);
  });

  test("a single field is still one item", () => {
    expect(splitTopLevel("a: 1")).toEqual(["a: 1"]);
  });
});
