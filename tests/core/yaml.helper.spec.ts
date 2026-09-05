/**
 * The YAML emitter.
 *
 * This spec exists for a concrete reason: at first YAML was not emitted
 * **precisely** out of fear of these rules. The decision was reviewed,
 * and what makes it safe is quoting every string — so what must be
 * tested is exactly that, with the values that silently corrupt a
 * document.
 */
import { describe, expect, test } from "vitest";

import { toYaml } from "../../packages/core/helpers/yaml.helper";

describe("dangerous strings are quoted", () => {
  // The YAML hell table: without quotes, each of these stops being
  // the string it was.
  test.each([
    ["sí", '"sí"'],
    ["yes", '"yes"'],
    ["no", '"no"'],
    ["on", '"on"'],
    ["off", '"off"'],
    ["true", '"true"'],
    ["null", '"null"'],
    ["~", '"~"'],
    ["", '""'],
    ["1.0", '"1.0"'],
    ["08", '"08"'],
    ["#comentario", '"#comentario"'],
    ["hola: mundo", '"hola: mundo"'],
    ["- guion", '"- guion"'],
    ["*ancla", '"*ancla"'],
    ["&ref", '"&ref"'],
  ])("%s is emitted as %s", (input, expected) => {
    expect(toYaml({ v: input })).toBe(`v: ${expected}\n`);
  });

  test("a line break is escaped, it does not break the block", () => {
    expect(toYaml({ v: "una\ndos" })).toBe('v: "una\\ndos"\n');
  });

  test("quotes inside are escaped", () => {
    expect(toYaml({ v: 'dice "hola"' })).toBe('v: "dice \\"hola\\""\n');
  });

  test("unicode survives", () => {
    expect(toYaml({ v: "añadió ñ y €" })).toBe('v: "añadió ñ y €"\n');
  });
});

describe("numbers and booleans are NOT quoted", () => {
  // Quoting them would turn them into text, which is the symmetric
  // error.
  test("a number is a number", () => {
    expect(toYaml({ v: 42 })).toBe("v: 42\n");
    expect(toYaml({ v: 1.5 })).toBe("v: 1.5\n");
    expect(toYaml({ v: 0 })).toBe("v: 0\n");
  });

  test("a boolean is a boolean", () => {
    expect(toYaml({ v: true })).toBe("v: true\n");
    expect(toYaml({ v: false })).toBe("v: false\n");
  });

  test("null is null", () => {
    expect(toYaml({ v: null })).toBe("v: null\n");
  });

  test("NaN and Infinity are not valid YAML, so they come out as null", () => {
    expect(toYaml({ v: Number.NaN })).toBe("v: null\n");
    expect(toYaml({ v: Number.POSITIVE_INFINITY })).toBe("v: null\n");
  });
});

describe("keys", () => {
  test("an identifier goes without quotes", () => {
    expect(toYaml({ openapi: "3.1.0" })).toBe('openapi: "3.1.0"\n');
  });

  // OpenAPI keys are paths and status codes.
  test("a path is quoted", () => {
    expect(toYaml({ "/api/users": 1 })).toBe('"/api/users": 1\n');
  });

  test("a status code is quoted", () => {
    expect(toYaml({ "200": "OK" })).toBe('"200": "OK"\n');
  });

  test("a mime type is quoted", () => {
    expect(toYaml({ "application/json": 1 })).toBe('"application/json": 1\n');
  });

  test("a reserved key is quoted", () => {
    expect(toYaml({ no: 1 })).toBe('"no": 1\n');
  });
});

describe("structure", () => {
  test("nested objects are indented by two", () => {
    expect(toYaml({ info: { title: "API", version: "1.0.0" } })).toBe(
      'info:\n  title: "API"\n  version: "1.0.0"\n',
    );
  });

  test("a list of scalars", () => {
    expect(toYaml({ tags: ["a", "b"] })).toBe('tags:\n- "a"\n- "b"\n');
  });

  test("a list of objects sticks the dash to the first line", () => {
    expect(toYaml({ servers: [{ url: "http://x" }] })).toBe(
      'servers:\n- url: "http://x"\n',
    );
  });

  test("an empty object is `{}`, not a stray key", () => {
    expect(toYaml({ scopes: {} })).toBe("scopes: {}\n");
  });

  test("an empty list is `[]`", () => {
    expect(toYaml({ security: [] })).toBe("security: []\n");
  });

  test("`undefined` is omitted instead of emitting a key without a value", () => {
    expect(toYaml({ a: 1, b: undefined })).toBe("a: 1\n");
  });

  test("always ends with a newline", () => {
    expect(toYaml({ a: 1 }).endsWith("\n")).toBe(true);
  });
});

describe("a document with the shape of an OpenAPI", () => {
  const doc = toYaml({
    openapi: "3.1.0",
    info: { title: "Mi API", version: "1.0.0" },
    servers: [{ url: "http://localhost:3000" }],
    paths: {
      "/api/users": {
        get: {
          summary: "List Users",
          parameters: [{ name: "page", in: "query", required: false }],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  });

  test("comes out in the expected shape", () => {
    expect(doc).toContain('openapi: "3.1.0"');
    expect(doc).toContain('  "/api/users":');
    // The sequence is indented to its key's level, which is what
    // everyone does and what YAML allows.
    expect(doc).toContain('      - name: "page"');
    expect(doc).toContain('        "200":');
    expect(doc).toContain('          description: "OK"');
  });

  // The litmus test: that a real parser reads it the same way. There
  // is no YAML library in the repo, so we check the property that
  // matters — no unquoted strings — over the whole document.
  test("no string was left unquoted", () => {
    for (const line of doc.split("\n")) {
      const value = /: (.+)$/.exec(line)?.[1];
      if (!value) continue;
      const ok =
        value.startsWith('"') ||
        value === "{}" ||
        value === "[]" ||
        value === "null" ||
        value === "true" ||
        value === "false" ||
        /^-?\d+(\.\d+)?$/.test(value);
      expect(ok, `unquoted: ${line}`).toBe(true);
    }
  });
});
