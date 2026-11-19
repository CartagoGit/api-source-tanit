import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { detectTypedRule, exampleValueForRule, generateBodyVariants, generateCompleteBody, generateMinimalBody, generateQueryVariants, parseFormRequest } from "../../packages/frameworks/laravel/form-request-parser.service";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";
import type { FormRequestRules } from "../../packages/contracts/interfaces/frameworks/scanners.interface";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";

let project: ITempProject;
let context: ReturnType<typeof resolveProjectContext>;

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
  context = resolveProjectContext({ projectRoot: project.root });
});

afterAll(async () => {
  await project.cleanup();
});

describe("parseFormRequest", () => {
  test("extracts all rules() fields", async () => {
    const rules = await parseFormRequest(
      "app/Http/Requests/CreateUserRequest.php",
      context,
    );
    expect(Object.keys(rules.rules)).toEqual(["name", "email", "age", "role", "avatar"]);
  });

  test("reads the class name", async () => {
    const rules = await parseFormRequest(
      "app/Http/Requests/CreateUserRequest.php",
      context,
    );
    expect(rules.className).toBe("CreateUserRequest");
  });

  test("understands rules as an array", async () => {
    const rules = await parseFormRequest(
      "app/Http/Requests/CreateUserRequest.php",
      context,
    );
    expect(rules.rules["name"]).toEqual(["required", "string", "max:80"]);
  });

  // Laravel accepts both syntaxes and both must be supported.
  test("understands rules as a | separated string", async () => {
    const rules = await parseFormRequest(
      "app/Http/Requests/CreateUserRequest.php",
      context,
    );
    expect(rules.rules["email"]).toEqual(["required", "email", "unique:users"]);
  });

  test("an empty rules() is flagged as isEmpty", async () => {
    const rules = await parseFormRequest("app/Http/Requests/EmptyRequest.php", context);
    expect(rules.isEmpty).toBe(true);
  });

  test("respects the project root it receives", async () => {
    const rules = await parseFormRequest(
      "app/Http/Requests/CreateUserRequest.php",
      context,
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

  test("with no type rule returns null", () => {
    expect(detectTypedRule(["required"])).toBeNull();
  });
});

describe("exampleValueForRule", () => {
  // All formats fell down the same branch as `date`, so an email
  // field ended up as "2024-01-15" in the example body.
  test.each([
    ["email", "@"],
    ["url", "https://"],
    ["uuid", "-"],
    ["ip", "."],
  ])("%s produces an example with the format of %s", (rule, marker) => {
    expect(String(exampleValueForRule(rule, "campo"))).toContain(marker);
  });

  test("every format produces a distinct example", () => {
    const values = ["string", "email", "url", "uuid", "ip", "date"].map((r) =>
      String(exampleValueForRule(r, "campo")),
    );
    expect(new Set(values).size).toBe(values.length);
  });

  test("a string uses the field name", () => {
    expect(exampleValueForRule("string", "apellido")).toBe("sample_apellido");
  });

  test("date still is a date", () => {
    expect(exampleValueForRule("date", "creado")).toBe("2024-01-15");
  });

  test("integer produces a number", () => {
    expect(typeof exampleValueForRule("integer", "age")).toBe("number");
  });

  test("boolean produces a boolean", () => {
    expect(typeof exampleValueForRule("boolean", "activo")).toBe("boolean");
  });

  test("an unknown rule does not throw", () => {
    expect(() => exampleValueForRule("regla_inventada", "x")).not.toThrow();
  });
});

function rulesOf(rules: Record<string, string[]>): FormRequestRules {
  return { sourceFile: "x.php", className: "X", rules, unknown: [], isEmpty: false };
}

describe("generateMinimalBody", () => {
  test("includes only required fields", () => {
    const body = generateMinimalBody(
      rulesOf({
        name: ["required", "string"],
        nota: ["nullable", "string"],
      }),
    );
    expect(Object.keys(body)).toEqual(["name"]);
  });

  test("an empty rules produces an empty body", () => {
    expect(generateMinimalBody(rulesOf({}))).toEqual({});
  });
});

describe("generateCompleteBody", () => {
  test("also includes optional fields", () => {
    const body = generateCompleteBody(
      rulesOf({
        name: ["required", "string"],
        nota: ["nullable", "string"],
      }),
    );
    expect(Object.keys(body)).toEqual(["name", "nota"]);
  });

  test("respects each field's type", () => {
    const body = generateCompleteBody(
      rulesOf({ edad: ["required", "integer"], activo: ["required", "boolean"] }),
    );
    expect(typeof body["edad"]).toBe("number");
    expect(typeof body["activo"]).toBe("boolean");
  });
});

describe("generateBodyVariants", () => {
  test("produces at least the minimal variant", () => {
    const variants = generateBodyVariants(
      rulesOf({ name: ["required", "string"], nota: ["nullable", "string"] }),
    );
    expect(variants.length).toBeGreaterThan(0);
    for (const variant of variants) expect(variant.name.length).toBeGreaterThan(0);
  });

  test("with no rules produces only the empty variant", () => {
    const variants = generateBodyVariants(rulesOf({}));
    expect(variants).toHaveLength(1);
    expect(variants[0]?.body).toEqual({});
  });
});

describe("generateQueryVariants", () => {
  test("each variant brings its query params", () => {
    const variants = generateQueryVariants(
      rulesOf({ search: ["nullable", "string"], page: ["nullable", "integer"] }),
    );
    for (const variant of variants) expect(Array.isArray(variant.query)).toBe(true);
  });

  test("with no rules produces no variants", () => {
    expect(generateQueryVariants(rulesOf({}))).toEqual([]);
  });
});
