import { describe, expect, test } from "vitest";
import { isPydanticRequired, mapPydanticFormat, mapPydanticType, parsePydanticModels, pydanticModelToSpecs } from "../../packages/frameworks/parsers/pydantic-schema.helper";
import { marshmallowFieldToSpec, marshmallowSchemaToSpecs, parseMarshmallowSchemas } from "../../packages/frameworks/parsers/marshmallow-schema.helper";

describe("parsePydanticModels", () => {
  const source = `
from pydantic import BaseModel
from typing import Optional, Literal

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    age: Optional[int] = None
    role: Literal["admin", "user"] = "user"

class Other(BaseModel):
    id: int
`;

  test("finds every model in the source", () => {
    expect(parsePydanticModels(source).map((m) => m.className)).toEqual([
      "UserCreate",
      "Other",
    ]);
  });

  test("collects each model's fields", () => {
    const model = parsePydanticModels(source)[0]!;
    expect([...model.fields.keys()]).toEqual(["name", "email", "age", "role"]);
  });

  // The class ends at the first non-empty line at column 0.
  test("does not drag fields from the next model", () => {
    const other = parsePydanticModels(source)[1]!;
    expect([...other.fields.keys()]).toEqual(["id"]);
  });

  test("ignores private fields", () => {
    const model = parsePydanticModels("class X(BaseModel):\n    _secret: str\n    ok: str")[0]!;
    expect([...model.fields.keys()]).toEqual(["ok"]);
  });

  test("accepts qualified pydantic.BaseModel", () => {
    expect(parsePydanticModels("class X(pydantic.BaseModel):\n    a: str")).toHaveLength(1);
  });

  test("returns [] when there are no models", () => {
    expect(parsePydanticModels("def foo(): pass")).toEqual([]);
  });
});

describe("mapPydanticType", () => {
  test.each([
    ["str", "string"],
    ["int", "integer"],
    ["float", "number"],
    ["bool", "boolean"],
    ["datetime", "datetime"],
    ["date", "date"],
    ["List[str]", "array"],
    ["Dict[str, int]", "object"],
  ])("maps %s to %s", (annotation, expected) => {
    expect(mapPydanticType(annotation)).toBe(expected);
  });

  test("types with a format remain string", () => {
    expect(mapPydanticType("EmailStr")).toBe("string");
    expect(mapPydanticType("HttpUrl")).toBe("string");
  });

  test("Optional[X] resolves to the inner type", () => {
    expect(mapPydanticType("Optional[int]")).toBe("integer");
  });

  test("unknown types fall back to any", () => {
    expect(mapPydanticType("MiTipoRaro")).toBe("any");
  });
});

describe("mapPydanticFormat", () => {
  test.each([
    ["EmailStr", "email"],
    ["HttpUrl", "url"],
    ["UUID4", "uuid"],
    ["IPvAnyAddress", "ip"],
  ])("%s → %s", (annotation, expected) => {
    expect(mapPydanticFormat(annotation)).toBe(expected);
  });

  test("with no format returns undefined", () => {
    expect(mapPydanticFormat("str")).toBeUndefined();
  });
});

describe("isPydanticRequired", () => {
  test("a simple field is required", () => {
    expect(isPydanticRequired("str")).toBe(true);
  });

  test("Optional makes it optional", () => {
    expect(isPydanticRequired("Optional[str]")).toBe(false);
  });
});

describe("pydanticModelToSpecs", () => {
  test("converts the whole model", () => {
    const model = parsePydanticModels(
      'class X(BaseModel):\n    email: EmailStr\n    role: Literal["a", "b"]\n',
    )[0]!;
    const specs = pydanticModelToSpecs(model);

    expect(specs[0]).toMatchObject({
      fieldName: "email",
      type: "string",
      format: "email",
      required: true,
      location: "body",
    });
    expect(specs[1]).toMatchObject({ type: "enum", enumValues: ["a", "b"] });
  });
});

describe("parseMarshmallowSchemas", () => {
  const source = `
from marshmallow import Schema, fields, validate

class UserSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=80))
    email = fields.Email(required=True)
    age = fields.Int(required=False)
    role = fields.Str(validate=validate.OneOf(["admin", "user"]))

class OtherSchema(Schema):
    id = fields.Int(required=True)
`;

  test("finds every schema", () => {
    expect(parseMarshmallowSchemas(source).map((s) => s.className)).toEqual([
      "UserSchema",
      "OtherSchema",
    ]);
  });

  test("collects each schema's fields", () => {
    expect([...parseMarshmallowSchemas(source)[0]!.fields.keys()]).toEqual([
      "name",
      "email",
      "age",
      "role",
    ]);
  });

  test("accepts SQLAlchemyAutoSchema", () => {
    expect(
      parseMarshmallowSchemas("class X(SQLAlchemyAutoSchema):\n    a = fields.Str()"),
    ).toHaveLength(1);
  });

  test("returns [] when there are no schemas", () => {
    expect(parseMarshmallowSchemas("def foo(): pass")).toEqual([]);
  });
});

describe("marshmallowFieldToSpec", () => {
  test.each([
    ["fields.Str()", "string"],
    ["fields.Int()", "integer"],
    ["fields.Float()", "number"],
    ["fields.Bool()", "boolean"],
    ["fields.DateTime()", "datetime"],
    ["fields.List(fields.Str())", "array"],
    ["fields.Nested(X)", "object"],
  ])("%s → type %s", (expression, expected) => {
    expect(marshmallowFieldToSpec("f", expression).type).toBe(expected);
  });

  test("fields.Email produces format email", () => {
    const spec = marshmallowFieldToSpec("email", "fields.Email(required=True)");
    expect(spec.type).toBe("string");
    expect(spec.format).toBe("email");
  });

  // Marshmallow is optional by default, the opposite of zod.
  test("only required with required=True", () => {
    expect(marshmallowFieldToSpec("a", "fields.Str(required=True)").required).toBe(true);
    expect(marshmallowFieldToSpec("a", "fields.Str()").required).toBe(false);
    expect(marshmallowFieldToSpec("a", "fields.Str(required=False)").required).toBe(false);
  });

  test("OneOf produces an enum with its values", () => {
    const spec = marshmallowFieldToSpec("r", 'fields.Str(validate=validate.OneOf(["a", "b"]))');
    expect(spec.type).toBe("enum");
    expect(spec.enumValues).toEqual(["a", "b"]);
  });

  test("Length produces minLength and maxLength", () => {
    const spec = marshmallowFieldToSpec(
      "n",
      "fields.Str(validate=validate.Length(min=2, max=80))",
    );
    expect(spec.minLength).toBe(2);
    expect(spec.maxLength).toBe(80);
  });

  test("accepts the ma. prefix", () => {
    expect(marshmallowFieldToSpec("a", "ma.fields.Str(required=True)").type).toBe("string");
  });
});

describe("marshmallowSchemaToSpecs", () => {
  test("respects the given location", () => {
    const schema = parseMarshmallowSchemas(
      "class X(Schema):\n    a = fields.Str(required=True)",
    )[0]!;
    expect(marshmallowSchemaToSpecs(schema, "query")[0]?.location).toBe("query");
  });
});
