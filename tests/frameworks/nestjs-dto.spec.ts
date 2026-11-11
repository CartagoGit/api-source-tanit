/**
 * NestJS DTOs: from `class-validator` to the example body.
 *
 * Three things were broken at once and none made any noise — the
 * endpoint simply came out without a body, which is indistinguishable
 * from "this endpoint receives nothing":
 *
 *   1. The field regex required `field!:` or `field::`. A plain
 *      `name: string`, which is how 99% of DTOs are written, never
 *      matched. The parser did not extract a single field — neither
 *      from a separate file nor from the class itself.
 *   2. Each decorator emitted its own spec, so
 *      `@IsString() @MinLength(1) @MaxLength(100) name: string` produced
 *      three fields named `name`, each with a piece of the information
 *      and none with all of it.
 *   3. The DTO was only looked up in imported files. A
 *      `class CreateUserDto` declared in the same file as the
 *      controller —which half the Nest docs show— was not found.
 */
import { describe, expect, test } from "vitest";

import { scannerBundleFor } from "../../packages/frameworks/index";
import { exampleDir } from "../../scripts/helpers/root.helper";
import type { IValidationSpec } from "../../packages/contracts/interfaces/core/scanner.interface";

const bundle = scannerBundleFor("nestjs");

async function fieldsFor(uri: string, method = "POST"): Promise<IValidationSpec[]> {
  if (!bundle?.validationProvider) throw new Error("nestjs is not in the registry");
  const match = await bundle.projectScanner.resolve(exampleDir("nestjs"));
  const result = await bundle.routeScanner.scan(match);
  const routes = result.routes;
  const route = routes.find((r) => r.method === method && r.uri === uri);
  if (!route) throw new Error(`${method} ${uri} not found — available: ${routes.map((r) => `${r.method} ${r.uri}`).join(", ")}`);
  return [...(await bundle.validationProvider.resolve(route, match, result)).fields];
}

describe("DTO declared in the same file as the controller", () => {
  test("extracts the fields exactly like an imported DTO", async () => {
    const fields = await fieldsFor("/users");
    expect(fields.map((f) => f.fieldName)).toEqual(["name", "email", "age", "role"]);
  });

  // One field, one spec. Not one per decorator.
  test("does not repeat a field per decorator it carries", async () => {
    const fields = await fieldsFor("/users");
    const names = fields.map((f) => f.fieldName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("decorators are merged into a single spec", () => {
  test("`@IsString() @MinLength(1) @MaxLength(100)` yields type and both bounds", async () => {
    const name = (await fieldsFor("/users")).find((f) => f.fieldName === "name");
    expect(name).toMatchObject({ type: "string", required: true });
    expect(name?.minLength).toBe(1);
    expect(name?.maxLength).toBe(100);
  });

  test("`@IsEmail()` sets the format on the field", async () => {
    const email = (await fieldsFor("/users")).find((f) => f.fieldName === "email");
    expect(email?.format).toBe("email");
    expect(email?.required).toBe(true);
  });

  /**
   * `@IsOptional()` is about optional-ness, not type. When each
   * decorator emitted its own spec, the `IsOptional` one brought its
   * own `type` and could overwrite the one from `@IsInt()`.
   */
  test("`@IsOptional()` marks optional without overwriting @IsInt()'s type", async () => {
    const age = (await fieldsFor("/users")).find((f) => f.fieldName === "age");
    expect(age?.required).toBe(false);
    expect(age?.type).toBe("integer");
    expect(age?.minimum).toBe(0);
    expect(age?.maximum).toBe(120);
  });

  test("`@IsEnum([...])` preserves the values", async () => {
    const role = (await fieldsFor("/users")).find((f) => f.fieldName === "role");
    expect(role?.enumValues).toEqual(["admin", "user", "guest"]);
    expect(role?.required).toBe(false);
  });
});

describe("other controllers in the same project", () => {
  test("orders resolves its own DTO", async () => {
    const fields = await fieldsFor("/orders");
    expect(fields.map((f) => f.fieldName)).toContain("customerEmail");
    expect(fields.length).toBeGreaterThan(2);
  });

  test("an update DTO yields its fields, all optional", async () => {
    const body = (await fieldsFor("/users/:id", "PUT")).filter((f) => f.location === "body");
    expect(body.map((f) => f.fieldName)).toEqual(["name", "age"]);
    expect(body.every((f) => !f.required)).toBe(true);
  });
});

/**
 * `@Query("page") page: number` is a query parameter, not a body field.
 * The difference matters: a GET has no body, so documenting it there
 * describes a request that cannot be made.
 *
 * It came out wrong because the fallback matched a decorator with
 * **any** field within the 9 lines before it and marked everything as
 * `body`: a GET's `page` showed up as a body field, with the type of
 * the first `@IsString()` that happened to be above.
 */
describe("method-signature parameters", () => {
  test("`@Query()` is documented as query, not body", async () => {
    const fields = await fieldsFor("/users", "GET");
    const page = fields.find((f) => f.fieldName === "page");
    expect(page?.location).toBe("query");
    expect(page?.type).toBe("number");
  });

  test("`@Param()` is documented as path", async () => {
    const fields = await fieldsFor("/users/:id", "GET");
    expect(fields.find((f) => f.fieldName === "id")?.location).toBe("path");
  });

  test("a GET does not end up with body fields", async () => {
    const fields = await fieldsFor("/users", "GET");
    expect(fields.filter((f) => f.location === "body")).toEqual([]);
  });
});
