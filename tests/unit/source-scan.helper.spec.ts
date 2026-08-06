import { describe, expect, test } from "bun:test";
import {
  countLinesBefore,
  findAllBalanced,
  findClosingParen,
  findNearestBalanced,
  splitTopLevel,
  stripJsComments,
  unwrapObjectLiteralItem,
} from "../../helper/source-scan.helper";

describe("stripJsComments", () => {
  test("elimina comentarios de bloque", () => {
    expect(stripJsComments("a /* fuera */ b")).toBe("a  b");
  });

  test("elimina comentarios de línea", () => {
    expect(stripJsComments("const a = 1; // fuera\nconst b = 2;")).toBe(
      "const a = 1; \nconst b = 2;",
    );
  });

  test("no parte las URLs con https://", () => {
    expect(stripJsComments('const u = "https://api.example.com/users";')).toContain(
      "https://api.example.com/users",
    );
  });

  test("un endpoint comentado no sobrevive al strip", () => {
    const src = ["app.get('/live', h);", "// app.get('/muerto', h);"].join("\n");
    expect(stripJsComments(src)).not.toContain("/muerto");
    expect(stripJsComments(src)).toContain("/live");
  });
});

describe("findClosingParen", () => {
  test("encuentra el cierre respetando anidamiento", () => {
    const text = "f(a, g(b), c)";
    expect(findClosingParen(text, 1)).toBe(text.length - 1);
  });

  test("devuelve -1 si nunca cierra", () => {
    expect(findClosingParen("f(a, b", 1)).toBe(-1);
  });
});

describe("findAllBalanced", () => {
  test("encuentra todas las llamadas y sus límites", () => {
    const text = "z.object({ a: 1 }) y z.object({ b: 2 })";
    const calls = findAllBalanced(text, /z\.object\s*\(/);
    expect(calls).toHaveLength(2);
    expect(text.slice(calls[0]!.callStart + 1, calls[0]!.callEnd)).toBe("{ a: 1 }");
    expect(text.slice(calls[1]!.callStart + 1, calls[1]!.callEnd)).toBe("{ b: 2 }");
  });

  test("respeta paréntesis anidados dentro de la llamada", () => {
    const text = "z.object({ a: z.string().min(1) })";
    const calls = findAllBalanced(text, /z\.object\s*\(/);
    expect(text.slice(calls[0]!.callStart + 1, calls[0]!.callEnd)).toBe(
      "{ a: z.string().min(1) }",
    );
  });

  test("descarta llamadas sin cierre", () => {
    expect(findAllBalanced("z.object({ a: 1 }", /z\.object\s*\(/)).toHaveLength(0);
  });

  // Regresión: la copia que vivía en nextjs.scanner.ts iteraba con
  // `exec()` sobre una regex SIN flag `g`, así que `lastIndex` no
  // avanzaba nunca y el escaneo de cualquier proyecto Next.js con un
  // `z.object(` colgaba el proceso indefinidamente.
  test("termina aunque el patrón se pase sin flag global", () => {
    const text = "z.object({ a: 1 }) z.object({ b: 2 }) z.object({ c: 3 })";
    const nonGlobal = /z\.object\s*\(/;
    expect(nonGlobal.global).toBe(false);
    expect(findAllBalanced(text, nonGlobal)).toHaveLength(3);
  });

  test("acepta también un patrón que ya trae flag global", () => {
    const text = "z.object({ a: 1 }) z.object({ b: 2 })";
    expect(findAllBalanced(text, /z\.object\s*\(/g)).toHaveLength(2);
  });
});

describe("findNearestBalanced", () => {
  const text = [
    "const arriba = z.object({ a: 1 });", // línea 0
    "",
    "",
    "function handler() {}", // línea 3
    "",
    "const abajo = z.object({ b: 2 });", // línea 5
  ].join("\n");

  test("elige el schema más cercano por encima", () => {
    const call = findNearestBalanced(text, /z\.object\s*\(/, 2);
    expect(text.slice(call!.callStart + 1, call!.callEnd)).toBe("{ a: 1 }");
  });

  test("elige el schema más cercano por debajo", () => {
    const call = findNearestBalanced(text, /z\.object\s*\(/, 5);
    expect(text.slice(call!.callStart + 1, call!.callEnd)).toBe("{ b: 2 }");
  });

  test("devuelve null si no hay ninguna coincidencia", () => {
    expect(findNearestBalanced("sin schemas", /z\.object\s*\(/, 0)).toBeNull();
  });
});

describe("countLinesBefore", () => {
  test("cuenta saltos de línea antes del índice", () => {
    const text = "a\nb\nc";
    expect(countLinesBefore(text, 0)).toBe(0);
    expect(countLinesBefore(text, 2)).toBe(1);
    expect(countLinesBefore(text, 4)).toBe(2);
  });
});

describe("splitTopLevel", () => {
  test("parte por comas de primer nivel", () => {
    expect(splitTopLevel("{ a: 1, b: 2 }")).toEqual(["{ a: 1", "b: 2 }"]);
  });

  test("ignora comas dentro de objetos anidados", () => {
    const items = splitTopLevel("{ a: z.enum(['x', 'y']), b: 2 }");
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("z.enum(['x', 'y'])");
  });

  test("ignora comas dentro de strings", () => {
    const items = splitTopLevel(`{ a: "uno,dos", b: 2 }`);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("uno,dos");
  });

  test("respeta escapes dentro de strings", () => {
    const items = splitTopLevel(`{ a: "con \\" comilla, y coma", b: 2 }`);
    expect(items).toHaveLength(2);
  });

  test("soporta template literals", () => {
    const items = splitTopLevel("{ a: `uno,dos`, b: 2 }");
    expect(items).toHaveLength(2);
  });
});

describe("unwrapObjectLiteralItem", () => {
  test("quita la llave de apertura del primer item", () => {
    expect(unwrapObjectLiteralItem("{ a: 1")).toBe("a: 1");
  });

  test("quita la llave de cierre del último item", () => {
    expect(unwrapObjectLiteralItem("b: 2 }")).toBe("b: 2");
  });

  test("deja intacto un item central", () => {
    expect(unwrapObjectLiteralItem("  b: 2  ")).toBe("b: 2");
  });
});
