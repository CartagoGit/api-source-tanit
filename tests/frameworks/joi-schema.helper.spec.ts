import { describe, expect, test } from "vitest";
import { joiFieldToSpec, parseJoiFieldExpression, parseJoiObjectLiteral } from "../../packages/frameworks/parsers/joi-schema.helper";

describe("parseJoiFieldExpression", () => {
  test("maps Joi.string() to type string", () => {
    const f = parseJoiFieldExpression("name: Joi.string()");
    expect(f).toMatchObject({ name: "name", type: "string", required: true });
  });

  test("maps number, boolean, date, array and integer", () => {
    expect(parseJoiFieldExpression("a: Joi.number()")?.type).toBe("number");
    expect(parseJoiFieldExpression("a: Joi.boolean()")?.type).toBe("boolean");
    expect(parseJoiFieldExpression("a: Joi.date()")?.type).toBe("date");
    expect(parseJoiFieldExpression("a: Joi.array()")?.type).toBe("array");
    expect(parseJoiFieldExpression("a: Joi.integer()")?.type).toBe("integer");
  });

  test("extracts format from chaining", () => {
    expect(parseJoiFieldExpression("a: Joi.string().email()")?.format).toBe("email");
    expect(parseJoiFieldExpression("a: Joi.string().uri()")?.format).toBe("url");
    expect(parseJoiFieldExpression("a: Joi.string().guid()")?.format).toBe("uuid");
  });

  test("extracts format from the base method", () => {
    expect(parseJoiFieldExpression("a: Joi.email()")?.format).toBe("email");
    expect(parseJoiFieldExpression("a: Joi.guid()")?.format).toBe("uuid");
  });

  test("optional() marks required: false", () => {
    expect(parseJoiFieldExpression("a: Joi.string().optional()")?.required).toBe(false);
    expect(parseJoiFieldExpression("a: Joi.string().required()")?.required).toBe(true);
  });

  test("extracts min and max", () => {
    const f = parseJoiFieldExpression("a: Joi.string().min(3).max(20)");
    expect(f?.minLength).toBe(3);
    expect(f?.maxLength).toBe(20);
  });

  test("valid(...) produces enumValues", () => {
    const f = parseJoiFieldExpression(`role: Joi.string().valid("admin", "user")`);
    expect(f?.enumValues).toEqual(["admin", "user"]);
  });

  test("returns null when the expression is not Joi", () => {
    expect(parseJoiFieldExpression("a: z.string()")).toBeNull();
  });
});

describe("parseJoiObjectLiteral", () => {
  test("parses a multi-field schema", () => {
    const fields = parseJoiObjectLiteral(`{
      name: Joi.string().min(1).required(),
      email: Joi.string().email().required(),
      age: Joi.number().optional(),
    }`);
    expect(fields.map((f) => f.name)).toEqual(["name", "email", "age"]);
    expect(fields[1]?.format).toBe("email");
    expect(fields[2]?.required).toBe(false);
  });

  test("ignores entries that do not match the heuristic", () => {
    expect(parseJoiObjectLiteral("{ ...base, a: Joi.string() }").map((f) => f.name)).toEqual([
      "a",
    ]);
  });

  test("returns [] for an empty object", () => {
    expect(parseJoiObjectLiteral("{}")).toEqual([]);
  });
});

describe("joiFieldToSpec", () => {
  test("uses location body by default", () => {
    const spec = joiFieldToSpec({ name: "a", type: "string", required: true });
    expect(spec).toEqual({ fieldName: "a", location: "body", type: "string", required: true });
  });

  test("respects explicit location", () => {
    expect(joiFieldToSpec({ name: "a", type: "string", required: true }, "header").location).toBe(
      "header",
    );
  });

  test("propagates format, enumValues and lengths", () => {
    const spec = joiFieldToSpec({
      name: "role",
      type: "enum",
      required: false,
      format: "uuid",
      enumValues: ["a"],
      minLength: 1,
      maxLength: 9,
    });
    expect(spec).toMatchObject({
      format: "uuid",
      enumValues: ["a"],
      minLength: 1,
      maxLength: 9,
      required: false,
    });
  });
});
