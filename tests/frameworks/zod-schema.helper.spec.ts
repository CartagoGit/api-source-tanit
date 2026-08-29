import { describe, expect, test } from "vitest";
import { parseZodFieldExpression, parseZodObjectLiteral, zodFieldToSpec } from "../../packages/frameworks/parsers/zod-schema.helper";

describe("parseZodFieldExpression", () => {
  test("mapea z.string() a type string y required", () => {
    const f = parseZodFieldExpression("name", "z.string()");
    expect(f).toMatchObject({ name: "name", type: "string", required: true });
  });

  test("mapea z.number(), z.boolean(), z.date(), z.array()", () => {
    expect(parseZodFieldExpression("a", "z.number()")?.type).toBe("number");
    expect(parseZodFieldExpression("a", "z.boolean()")?.type).toBe("boolean");
    expect(parseZodFieldExpression("a", "z.date()")?.type).toBe("date");
    expect(parseZodFieldExpression("a", "z.array(z.string())")?.type).toBe("array");
  });

  test("extrae format desde el chaining", () => {
    expect(parseZodFieldExpression("email", "z.string().email()")?.format).toBe("email");
    expect(parseZodFieldExpression("web", "z.string().url()")?.format).toBe("url");
    expect(parseZodFieldExpression("id", "z.string().uuid()")?.format).toBe("uuid");
    expect(parseZodFieldExpression("at", "z.string().datetime()")?.format).toBe("date-time");
  });

  test("el tipo sigue siendo string cuando hay format", () => {
    expect(parseZodFieldExpression("email", "z.string().email()")?.type).toBe("string");
  });

  test("optional() y nullable() marcan required: false", () => {
    expect(parseZodFieldExpression("a", "z.string().optional()")?.required).toBe(false);
    expect(parseZodFieldExpression("a", "z.string().nullable()")?.required).toBe(false);
    expect(parseZodFieldExpression("a", "z.string()")?.required).toBe(true);
  });

  // `.min()` se guarda crudo: en zod es el mismo método con dos
  // significados según el tipo base, y quien lo interpreta es
  // `zodFieldToSpec`, que es quien conoce el tipo.
  test("extrae min y max sin interpretarlos", () => {
    const f = parseZodFieldExpression("name", "z.string().min(2).max(64)");
    expect(f?.min).toBe(2);
    expect(f?.max).toBe(64);
  });

  test("z.enum([...]) produce type enum con sus valores", () => {
    const f = parseZodFieldExpression("role", 'z.enum(["admin", "user"])');
    expect(f?.type).toBe("enum");
    expect(f?.enumValues).toEqual(["admin", "user"]);
  });

  test("devuelve null si la expresión no es zod", () => {
    expect(parseZodFieldExpression("a", "someOther.string()")).toBeNull();
  });
});

describe("parseZodObjectLiteral", () => {
  test("parsea un schema multi-campo", () => {
    const fields = parseZodObjectLiteral(`{
      name: z.string().min(1),
      email: z.string().email(),
      age: z.number().optional(),
    }`);
    expect(fields.map((f) => f.name)).toEqual(["name", "email", "age"]);
    expect(fields[1]?.format).toBe("email");
    expect(fields[2]?.required).toBe(false);
  });

  test("acepta keys entrecomilladas (headers en kebab-case)", () => {
    const fields = parseZodObjectLiteral(`{ "X-API-Key": z.string() }`);
    expect(fields[0]?.name).toBe("X-API-Key");
  });

  test("no se rompe con campos anidados", () => {
    const fields = parseZodObjectLiteral(`{
      user: z.object({ id: z.string() }),
      tags: z.array(z.string()),
    }`);
    expect(fields.map((f) => f.name)).toEqual(["user", "tags"]);
    expect(fields[0]?.type).toBe("object");
    expect(fields[1]?.type).toBe("array");
  });

  test("ignora entradas que no casan la heurística", () => {
    expect(parseZodObjectLiteral("{ ...spread, a: z.string() }").map((f) => f.name)).toEqual([
      "a",
    ]);
  });

  test("devuelve [] con un objeto vacío", () => {
    expect(parseZodObjectLiteral("{}")).toEqual([]);
  });
});

describe("zodFieldToSpec", () => {
  test("usa location body por defecto", () => {
    const spec = zodFieldToSpec({ name: "a", type: "string", required: true });
    expect(spec).toEqual({ fieldName: "a", location: "body", type: "string", required: true });
  });

  test("respeta la location explícita", () => {
    const spec = zodFieldToSpec({ name: "a", type: "string", required: true }, "header");
    expect(spec.location).toBe("header");
  });

  test("propaga format, enumValues y longitudes", () => {
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
   * `z.string().min(2)` son dos caracteres; `z.number().min(2)` es el
   * valor dos. Es el mismo método y significa cosas distintas.
   *
   * Iba todo a `minLength`, así que un `z.number().min(0).max(120)`
   * producía un campo numérico con `minLength: 0` — una restricción que
   * no dice nada sobre un número y que las herramientas que leen el JSON
   * Schema ignoran. La cota se perdía sin más.
   */
  test("sobre un número, min/max son cotas de VALOR", () => {
    const spec = zodFieldToSpec({ name: "age", type: "number", required: true, min: 0, max: 120 });
    expect(spec.minimum).toBe(0);
    expect(spec.maximum).toBe(120);
    expect(spec.minLength).toBeUndefined();
    expect(spec.maxLength).toBeUndefined();
  });

  test("sobre una cadena, min/max son cotas de LONGITUD", () => {
    const spec = zodFieldToSpec({ name: "n", type: "string", required: true, min: 2, max: 64 });
    expect(spec.minLength).toBe(2);
    expect(spec.maxLength).toBe(64);
    expect(spec.minimum).toBeUndefined();
    expect(spec.maximum).toBeUndefined();
  });

  test("un entero también recibe cotas de valor", () => {
    const spec = zodFieldToSpec({ name: "n", type: "integer", required: true, min: 1 });
    expect(spec.minimum).toBe(1);
    expect(spec.minLength).toBeUndefined();
  });

  test("omite las claves opcionales ausentes", () => {
    const spec = zodFieldToSpec({ name: "a", type: "string", required: true });
    expect(Object.keys(spec).sort()).toEqual(["fieldName", "location", "required", "type"]);
  });
});
