import { describe, expect, test } from "bun:test";
import {
  joiFieldToSpec,
  parseJoiFieldExpression,
  parseJoiObjectLiteral,
} from "../../helper/joi-schema.helper";

describe("parseJoiFieldExpression", () => {
  test("mapea Joi.string() a type string", () => {
    const f = parseJoiFieldExpression("name: Joi.string()");
    expect(f).toMatchObject({ name: "name", type: "string", required: true });
  });

  test("mapea number, boolean, date, array e integer", () => {
    expect(parseJoiFieldExpression("a: Joi.number()")?.type).toBe("number");
    expect(parseJoiFieldExpression("a: Joi.boolean()")?.type).toBe("boolean");
    expect(parseJoiFieldExpression("a: Joi.date()")?.type).toBe("date");
    expect(parseJoiFieldExpression("a: Joi.array()")?.type).toBe("array");
    expect(parseJoiFieldExpression("a: Joi.integer()")?.type).toBe("integer");
  });

  test("extrae format desde el chaining", () => {
    expect(parseJoiFieldExpression("a: Joi.string().email()")?.format).toBe("email");
    expect(parseJoiFieldExpression("a: Joi.string().uri()")?.format).toBe("url");
    expect(parseJoiFieldExpression("a: Joi.string().guid()")?.format).toBe("uuid");
  });

  test("extrae format desde el método base", () => {
    expect(parseJoiFieldExpression("a: Joi.email()")?.format).toBe("email");
    expect(parseJoiFieldExpression("a: Joi.guid()")?.format).toBe("uuid");
  });

  test("optional() marca required: false", () => {
    expect(parseJoiFieldExpression("a: Joi.string().optional()")?.required).toBe(false);
    expect(parseJoiFieldExpression("a: Joi.string().required()")?.required).toBe(true);
  });

  test("extrae min y max", () => {
    const f = parseJoiFieldExpression("a: Joi.string().min(3).max(20)");
    expect(f?.minLength).toBe(3);
    expect(f?.maxLength).toBe(20);
  });

  test("valid(...) produce enumValues", () => {
    const f = parseJoiFieldExpression(`role: Joi.string().valid("admin", "user")`);
    expect(f?.enumValues).toEqual(["admin", "user"]);
  });

  test("devuelve null si la expresión no es Joi", () => {
    expect(parseJoiFieldExpression("a: z.string()")).toBeNull();
  });
});

describe("parseJoiObjectLiteral", () => {
  test("parsea un schema multi-campo", () => {
    const fields = parseJoiObjectLiteral(`{
      name: Joi.string().min(1).required(),
      email: Joi.string().email().required(),
      age: Joi.number().optional(),
    }`);
    expect(fields.map((f) => f.name)).toEqual(["name", "email", "age"]);
    expect(fields[1]?.format).toBe("email");
    expect(fields[2]?.required).toBe(false);
  });

  test("ignora entradas que no casan la heurística", () => {
    expect(parseJoiObjectLiteral("{ ...base, a: Joi.string() }").map((f) => f.name)).toEqual([
      "a",
    ]);
  });

  test("devuelve [] con un objeto vacío", () => {
    expect(parseJoiObjectLiteral("{}")).toEqual([]);
  });
});

describe("joiFieldToSpec", () => {
  test("usa location body por defecto", () => {
    const spec = joiFieldToSpec({ name: "a", type: "string", required: true });
    expect(spec).toEqual({ fieldName: "a", location: "body", type: "string", required: true });
  });

  test("respeta la location explícita", () => {
    expect(joiFieldToSpec({ name: "a", type: "string", required: true }, "header").location).toBe(
      "header",
    );
  });

  test("propaga format, enumValues y longitudes", () => {
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
