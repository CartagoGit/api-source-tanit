import { describe, expect, test } from "vitest";
import { parseZodFieldExpression, parseZodObjectLiteral, zodFieldToSpec } from "../../packages/frameworks/parsers/zod-schema.helper";

describe("parseZodFieldExpression", () => {
  test("maps z.string() to type string and required", () => {
    const f = parseZodFieldExpression("name", "z.string()");
    expect(f).toMatchObject({ name: "name", type: "string", required: true });
  });

  test("maps z.number(), z.boolean(), z.date(), z.array()", () => {
    expect(parseZodFieldExpression("a", "z.number()")?.type).toBe("number");
    expect(parseZodFieldExpression("a", "z.boolean()")?.type).toBe("boolean");
    expect(parseZodFieldExpression("a", "z.date()")?.type).toBe("date");
    expect(parseZodFieldExpression("a", "z.array(z.string())")?.type).toBe("array");
  });

  test("extracts format from chaining", () => {
    expect(parseZodFieldExpression("email", "z.string().email()")?.format).toBe("email");
    expect(parseZodFieldExpression("web", "z.string().url()")?.format).toBe("url");
    expect(parseZodFieldExpression("id", "z.string().uuid()")?.format).toBe("uuid");
    expect(parseZodFieldExpression("at", "z.string().datetime()")?.format).toBe("date-time");
  });

  test("the type stays string when there is a format", () => {
    expect(parseZodFieldExpression("email", "z.string().email()")?.type).toBe("string");
  });

  test("optional() and nullable() mark required: false", () => {
    expect(parseZodFieldExpression("a", "z.string().optional()")?.required).toBe(false);
    expect(parseZodFieldExpression("a", "z.string().nullable()")?.required).toBe(false);
    expect(parseZodFieldExpression("a", "z.string()")?.required).toBe(true);
  });

  // `.min()` is stored raw: in zod it is the same method with two
  // meanings depending on the base type, and the one that interprets
  // it is `zodFieldToSpec`, which is the one that knows the type.
  test("extracts min and max without interpreting them", () => {
    const f = parseZodFieldExpression("name", "z.string().min(2).max(64)");
    expect(f?.min).toBe(2);
    expect(f?.max).toBe(64);
  });

  test("z.enum([...]) produces type enum with its values", () => {
    const f = parseZodFieldExpression("role", 'z.enum(["admin", "user"])');
    expect(f?.type).toBe("enum");
    expect(f?.enumValues).toEqual(["admin", "user"]);
  });

  test("returns null when the expression is not zod", () => {
    expect(parseZodFieldExpression("a", "someOther.string()")).toBeNull();
  });
});

describe("parseZodObjectLiteral", () => {
  test("parses a multi-field schema", () => {
    const fields = parseZodObjectLiteral(`{
      name: z.string().min(1),
      email: z.string().email(),
      age: z.number().optional(),
    }`);
    expect(fields.map((f) => f.name)).toEqual(["name", "email", "age"]);
    expect(fields[1]?.format).toBe("email");
    expect(fields[2]?.required).toBe(false);
  });

  test("accepts quoted keys (kebab-case headers)", () => {
    const fields = parseZodObjectLiteral(`{ "X-API-Key": z.string() }`);
    expect(fields[0]?.name).toBe("X-API-Key");
  });

  test("does not break with nested fields", () => {
    const fields = parseZodObjectLiteral(`{
      user: z.object({ id: z.string() }),
      tags: z.array(z.string()),
    }`);
    expect(fields.map((f) => f.name)).toEqual(["user", "tags"]);
    expect(fields[0]?.type).toBe("object");
    expect(fields[1]?.type).toBe("array");
  });

  test("ignores entries that do not match the heuristic", () => {
    expect(parseZodObjectLiteral("{ ...spread, a: z.string() }").map((f) => f.name)).toEqual([
      "a",
    ]);
  });

  test("returns [] for an empty object", () => {
    expect(parseZodObjectLiteral("{}")).toEqual([]);
  });
});

describe("zodFieldToSpec", () => {
  test("uses location body by default", () => {
    const spec = zodFieldToSpec({ name: "a", type: "string", required: true });
    expect(spec).toEqual({ fieldName: "a", location: "body", type: "string", required: true });
  });

  test("respects explicit location", () => {
    const spec = zodFieldToSpec({ name: "a", type: "string", required: true }, "header");
    expect(spec.location).toBe("header");
  });

  test("propagates format, enumValues and lengths", () => {
    const spec = zodFieldToSpec({
      name: "role",
      type: "enum",
      required: false,
      format: "email",
      enumValues: ["a", "b"],
      min: 1,
      max: 9,
    });
    expect(spec).toMatchObject({
      format: "email",
      enumValues: ["a", "b"],
      minLength: 1,
      maxLength: 9,
      required: false,
    });
  });

  /**
   * `z.string().min(2)` is two characters; `z.number().min(2)` is the
   * value two. Same method, different meanings.
   *
   * Everything went to `minLength`, so a `z.number().min(0).max(120)`
   * produced a numeric field with `minLength: 0` — a constraint that
   * says nothing about a number and that the JSON Schema tools
   * silently ignore. The bound was lost.
   */
  test("on a number, min/max are VALUE bounds", () => {
    const spec = zodFieldToSpec({ name: "age", type: "number", required: true, min: 0, max: 120 });
    expect(spec.minimum).toBe(0);
    expect(spec.maximum).toBe(120);
    expect(spec.minLength).toBeUndefined();
    expect(spec.maxLength).toBeUndefined();
  });

  test("on a string, min/max are LENGTH bounds", () => {
    const spec = zodFieldToSpec({ name: "n", type: "string", required: true, min: 2, max: 64 });
    expect(spec.minLength).toBe(2);
    expect(spec.maxLength).toBe(64);
    expect(spec.minimum).toBeUndefined();
    expect(spec.maximum).toBeUndefined();
  });

  test("an integer also receives value bounds", () => {
    const spec = zodFieldToSpec({ name: "n", type: "integer", required: true, min: 1 });
    expect(spec.minimum).toBe(1);
    expect(spec.minLength).toBeUndefined();
  });

  test("omits the optional keys that are absent", () => {
    const spec = zodFieldToSpec({ name: "a", type: "string", required: true });
    expect(Object.keys(spec).sort()).toEqual(["fieldName", "location", "required", "type"]);
  });
});
