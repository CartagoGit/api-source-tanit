import { describe, expect, test } from "vitest";
import {
  isPydanticRequired,
  mapPydanticFormat,
  mapPydanticType,
  parsePydanticModels,
  pydanticModelToSpecs,
} from "../../frameworks/parsers/pydantic-schema.helper";
import {
  marshmallowFieldToSpec,
  marshmallowSchemaToSpecs,
  parseMarshmallowSchemas,
} from "../../frameworks/parsers/marshmallow-schema.helper";

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

  test("encuentra todos los modelos del fuente", () => {
    expect(parsePydanticModels(source).map((m) => m.className)).toEqual([
      "UserCreate",
      "Other",
    ]);
  });

  test("recoge los campos de cada modelo", () => {
    const model = parsePydanticModels(source)[0]!;
    expect([...model.fields.keys()]).toEqual(["name", "email", "age", "role"]);
  });

  // La clase termina en la primera línea no vacía en columna 0.
  test("no arrastra campos del modelo siguiente", () => {
    const other = parsePydanticModels(source)[1]!;
    expect([...other.fields.keys()]).toEqual(["id"]);
  });

  test("ignora los campos privados", () => {
    const model = parsePydanticModels("class X(BaseModel):\n    _secret: str\n    ok: str")[0]!;
    expect([...model.fields.keys()]).toEqual(["ok"]);
  });

  test("acepta pydantic.BaseModel cualificado", () => {
    expect(parsePydanticModels("class X(pydantic.BaseModel):\n    a: str")).toHaveLength(1);
  });

  test("devuelve [] si no hay modelos", () => {
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
  ])("mapea %s a %s", (annotation, expected) => {
    expect(mapPydanticType(annotation)).toBe(expected as never);
  });

  test("los tipos con formato siguen siendo string", () => {
    expect(mapPydanticType("EmailStr")).toBe("string");
    expect(mapPydanticType("HttpUrl")).toBe("string");
  });

  test("Optional[X] se resuelve al tipo interior", () => {
    expect(mapPydanticType("Optional[int]")).toBe("integer");
  });

  test("lo desconocido cae a any", () => {
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

  test("sin formato devuelve undefined", () => {
    expect(mapPydanticFormat("str")).toBeUndefined();
  });
});

describe("isPydanticRequired", () => {
  test("un campo simple es obligatorio", () => {
    expect(isPydanticRequired("str")).toBe(true);
  });

  test("Optional lo hace opcional", () => {
    expect(isPydanticRequired("Optional[str]")).toBe(false);
  });
});

describe("pydanticModelToSpecs", () => {
  test("convierte el modelo entero", () => {
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

  test("encuentra todos los schemas", () => {
    expect(parseMarshmallowSchemas(source).map((s) => s.className)).toEqual([
      "UserSchema",
      "OtherSchema",
    ]);
  });

  test("recoge los campos de cada schema", () => {
    expect([...parseMarshmallowSchemas(source)[0]!.fields.keys()]).toEqual([
      "name",
      "email",
      "age",
      "role",
    ]);
  });

  test("acepta SQLAlchemyAutoSchema", () => {
    expect(
      parseMarshmallowSchemas("class X(SQLAlchemyAutoSchema):\n    a = fields.Str()"),
    ).toHaveLength(1);
  });

  test("devuelve [] si no hay schemas", () => {
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
    expect(marshmallowFieldToSpec("f", expression).type).toBe(expected as never);
  });

  test("fields.Email produce format email", () => {
    const spec = marshmallowFieldToSpec("email", "fields.Email(required=True)");
    expect(spec.type).toBe("string");
    expect(spec.format).toBe("email");
  });

  // Marshmallow es opcional por defecto, al revés que zod.
  test("solo es obligatorio con required=True", () => {
    expect(marshmallowFieldToSpec("a", "fields.Str(required=True)").required).toBe(true);
    expect(marshmallowFieldToSpec("a", "fields.Str()").required).toBe(false);
    expect(marshmallowFieldToSpec("a", "fields.Str(required=False)").required).toBe(false);
  });

  test("OneOf produce un enum con sus valores", () => {
    const spec = marshmallowFieldToSpec("r", 'fields.Str(validate=validate.OneOf(["a", "b"]))');
    expect(spec.type).toBe("enum");
    expect(spec.enumValues).toEqual(["a", "b"]);
  });

  test("Length produce minLength y maxLength", () => {
    const spec = marshmallowFieldToSpec(
      "n",
      "fields.Str(validate=validate.Length(min=2, max=80))",
    );
    expect(spec.minLength).toBe(2);
    expect(spec.maxLength).toBe(80);
  });

  test("acepta el prefijo ma.", () => {
    expect(marshmallowFieldToSpec("a", "ma.fields.Str(required=True)").type).toBe("string");
  });
});

describe("marshmallowSchemaToSpecs", () => {
  test("respeta la location indicada", () => {
    const schema = parseMarshmallowSchemas(
      "class X(Schema):\n    a = fields.Str(required=True)",
    )[0]!;
    expect(marshmallowSchemaToSpecs(schema, "query")[0]?.location).toBe("query");
  });
});
