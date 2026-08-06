import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  detectTypedRule,
  exampleValueForRule,
  generateBodyVariants,
  generateCompleteBody,
  generateMinimalBody,
  generateQueryVariants,
  parseFormRequest,
  type FormRequestRules,
} from "../../frameworks/laravel/form-request-parser.service";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";

let project: ITempProject;

const FORM_REQUEST = `<?php

namespace App\\Http\\Requests;

use Illuminate\\Foundation\\Http\\FormRequest;

class CreateUserRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:80'],
            'email' => 'required|email|unique:users',
            'age' => ['nullable', 'integer', 'min:0'],
            'role' => ['required', 'in:admin,user,guest'],
            'avatar' => ['nullable', 'file', 'mimes:png,jpg'],
        ];
    }
}
`;

beforeAll(async () => {
  project = await createTempProject({
    "app/Http/Requests/CreateUserRequest.php": FORM_REQUEST,
    "app/Http/Requests/EmptyRequest.php": `<?php
class EmptyRequest extends FormRequest
{
    public function rules(): array
    {
        return [];
    }
}
`,
  });
});

afterAll(async () => {
  await project.cleanup();
});

describe("parseFormRequest", () => {
  test("extrae todos los campos de rules()", async () => {
    const rules = await parseFormRequest(
      "app/Http/Requests/CreateUserRequest.php",
      project.root,
    );
    expect(Object.keys(rules.rules)).toEqual(["name", "email", "age", "role", "avatar"]);
  });

  test("lee el nombre de la clase", async () => {
    const rules = await parseFormRequest(
      "app/Http/Requests/CreateUserRequest.php",
      project.root,
    );
    expect(rules.className).toBe("CreateUserRequest");
  });

  test("entiende las reglas en array", async () => {
    const rules = await parseFormRequest(
      "app/Http/Requests/CreateUserRequest.php",
      project.root,
    );
    expect(rules.rules["name"]).toEqual(["required", "string", "max:80"]);
  });

  // Laravel acepta las dos sintaxis y hay que soportar ambas.
  test("entiende las reglas en string separadas por |", async () => {
    const rules = await parseFormRequest(
      "app/Http/Requests/CreateUserRequest.php",
      project.root,
    );
    expect(rules.rules["email"]).toEqual(["required", "email", "unique:users"]);
  });

  test("un rules() vacío se marca como isEmpty", async () => {
    const rules = await parseFormRequest("app/Http/Requests/EmptyRequest.php", project.root);
    expect(rules.isEmpty).toBe(true);
  });

  // Sin la raíz explícita, el parser dependía del singleton de
  // paths.service y no resolvía nada fuera del CLI.
  test("respeta la raíz de proyecto que se le pasa", async () => {
    const rules = await parseFormRequest(
      "app/Http/Requests/CreateUserRequest.php",
      project.root,
    );
    expect(rules.sourceFile).toBe("app/Http/Requests/CreateUserRequest.php");
  });
});

describe("detectTypedRule", () => {
  test.each([
    [["required", "string"], "string"],
    [["required", "integer"], "integer"],
    [["nullable", "boolean"], "boolean"],
    [["required", "email"], "email"],
    [["required", "date"], "date"],
  ])("%j → %s", (rules, expected) => {
    expect(detectTypedRule(rules)).toBe(expected);
  });

  test("sin regla de tipo devuelve null", () => {
    expect(detectTypedRule(["required"])).toBeNull();
  });
});

describe("exampleValueForRule", () => {
  // Todos los formatos caían en la misma rama que `date`, así que un
  // campo email salía como "2024-01-15" en el body de ejemplo.
  test.each([
    ["email", "@"],
    ["url", "https://"],
    ["uuid", "-"],
    ["ip", "."],
  ])("%s produce un ejemplo con formato de %s", (rule, marker) => {
    expect(String(exampleValueForRule(rule, "campo"))).toContain(marker);
  });

  test("cada formato produce un ejemplo distinto", () => {
    const values = ["string", "email", "url", "uuid", "ip", "date"].map((r) =>
      String(exampleValueForRule(r, "campo")),
    );
    expect(new Set(values).size).toBe(values.length);
  });

  test("un string usa el nombre del campo", () => {
    expect(exampleValueForRule("string", "apellido")).toBe("sample_apellido");
  });

  test("date sigue siendo una fecha", () => {
    expect(exampleValueForRule("date", "creado")).toBe("2024-01-15");
  });

  test("integer produce un número", () => {
    expect(typeof exampleValueForRule("integer", "age")).toBe("number");
  });

  test("boolean produce un booleano", () => {
    expect(typeof exampleValueForRule("boolean", "activo")).toBe("boolean");
  });

  test("una regla desconocida no lanza", () => {
    expect(() => exampleValueForRule("regla_inventada", "x")).not.toThrow();
  });
});

function rulesOf(rules: Record<string, string[]>): FormRequestRules {
  return { sourceFile: "x.php", className: "X", rules, unknown: [], isEmpty: false };
}

describe("generateMinimalBody", () => {
  test("incluye solo los campos required", () => {
    const body = generateMinimalBody(
      rulesOf({
        name: ["required", "string"],
        nota: ["nullable", "string"],
      }),
    );
    expect(Object.keys(body)).toEqual(["name"]);
  });

  test("un rules vacío produce un body vacío", () => {
    expect(generateMinimalBody(rulesOf({}))).toEqual({});
  });
});

describe("generateCompleteBody", () => {
  test("incluye también los opcionales", () => {
    const body = generateCompleteBody(
      rulesOf({
        name: ["required", "string"],
        nota: ["nullable", "string"],
      }),
    );
    expect(Object.keys(body)).toEqual(["name", "nota"]);
  });

  test("respeta el tipo de cada campo", () => {
    const body = generateCompleteBody(
      rulesOf({ edad: ["required", "integer"], activo: ["required", "boolean"] }),
    );
    expect(typeof body["edad"]).toBe("number");
    expect(typeof body["activo"]).toBe("boolean");
  });
});

describe("generateBodyVariants", () => {
  test("produce al menos la variante mínima", () => {
    const variants = generateBodyVariants(
      rulesOf({ name: ["required", "string"], nota: ["nullable", "string"] }),
    );
    expect(variants.length).toBeGreaterThan(0);
    for (const variant of variants) expect(variant.name.length).toBeGreaterThan(0);
  });

  test("sin reglas produce solo la variante vacía", () => {
    const variants = generateBodyVariants(rulesOf({}));
    expect(variants).toHaveLength(1);
    expect(variants[0]?.body).toEqual({});
  });
});

describe("generateQueryVariants", () => {
  test("cada variante trae sus query params", () => {
    const variants = generateQueryVariants(
      rulesOf({ search: ["nullable", "string"], page: ["nullable", "integer"] }),
    );
    for (const variant of variants) expect(Array.isArray(variant.query)).toBe(true);
  });

  test("sin reglas no produce variantes", () => {
    expect(generateQueryVariants(rulesOf({}))).toEqual([]);
  });
});
