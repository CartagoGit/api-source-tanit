/**
 * DTOs de NestJS: de `class-validator` al body de ejemplo.
 *
 * Tres cosas estaban rotas a la vez y ninguna hacía ruido — el endpoint
 * simplemente salía sin body, que es indistinguible de "este endpoint no
 * recibe nada":
 *
 *   1. El regex de campo exigía `field!:` o `field::`. Un `name: string`
 *      normal, que es como se declara el 99% de los DTO, no casaba
 *      **nunca**. El parser no sacaba un solo campo, ni de un fichero
 *      aparte ni de la propia clase.
 *   2. Cada decorador emitía su propia spec, así que
 *      `@IsString() @MinLength(1) @MaxLength(100) name: string` producía
 *      tres campos llamados `name`, cada uno con un trozo de la
 *      información y ninguno con toda.
 *   3. El DTO solo se buscaba en los ficheros importados. Una
 *      `class CreateUserDto` declarada en el mismo fichero que el
 *      controlador —lo que enseña media documentación de Nest— no se
 *      encontraba.
 */
import { describe, expect, test } from "vitest";

import { scannerBundleFor } from "../../projects/frameworks/index";
import { exampleDir } from "../../scripts/helpers/root.helper";
import type { IValidationSpec } from "../../projects/core/contracts/scanner.interface";

const bundle = scannerBundleFor("nestjs");

async function fieldsFor(uri: string, method = "POST"): Promise<IValidationSpec[]> {
  if (!bundle?.validationProvider) throw new Error("nestjs no está en el registro");
  const match = await bundle.projectScanner.resolve(exampleDir("nestjs"));
  const routes = await bundle.routeScanner.scan(match);
  const route = routes.find((r) => r.method === method && r.uri === uri);
  if (!route) throw new Error(`no se encontró ${method} ${uri} — hay: ${routes.map((r) => `${r.method} ${r.uri}`).join(", ")}`);
  return [...(await bundle.validationProvider.resolve(route, match)).fields];
}

describe("DTO declarado en el mismo fichero que el controlador", () => {
  test("saca los campos igual que si estuviera importado", async () => {
    const fields = await fieldsFor("/users");
    expect(fields.map((f) => f.fieldName)).toEqual(["name", "email", "age", "role"]);
  });

  // Un campo, una spec. No una por decorador.
  test("no repite un campo por cada decorador que lleva", async () => {
    const fields = await fieldsFor("/users");
    const names = fields.map((f) => f.fieldName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("los decoradores se funden en una sola spec", () => {
  test("`@IsString() @MinLength(1) @MaxLength(100)` da tipo y las dos cotas", async () => {
    const name = (await fieldsFor("/users")).find((f) => f.fieldName === "name");
    expect(name).toMatchObject({ type: "string", required: true });
    expect(name?.minLength).toBe(1);
    expect(name?.maxLength).toBe(100);
  });

  test("`@IsEmail()` deja el formato en el campo", async () => {
    const email = (await fieldsFor("/users")).find((f) => f.fieldName === "email");
    expect(email?.format).toBe("email");
    expect(email?.required).toBe(true);
  });

  /**
   * `@IsOptional()` habla de obligatoriedad, no de tipo. Cuando cada
   * decorador emitía su spec, el de `IsOptional` traía su propio `type`
   * y podía pisar al de `@IsInt()`.
   */
  test("`@IsOptional()` marca opcional sin pisar el tipo de `@IsInt()`", async () => {
    const age = (await fieldsFor("/users")).find((f) => f.fieldName === "age");
    expect(age?.required).toBe(false);
    expect(age?.type).toBe("integer");
    expect(age?.minimum).toBe(0);
    expect(age?.maximum).toBe(120);
  });

  test("`@IsEnum([...])` conserva los valores", async () => {
    const role = (await fieldsFor("/users")).find((f) => f.fieldName === "role");
    expect(role?.enumValues).toEqual(["admin", "user", "guest"]);
    expect(role?.required).toBe(false);
  });
});

describe("otros controladores del mismo proyecto", () => {
  test("orders resuelve su propio DTO", async () => {
    const fields = await fieldsFor("/orders");
    expect(fields.map((f) => f.fieldName)).toContain("customerEmail");
    expect(fields.length).toBeGreaterThan(2);
  });

  test("un DTO de update saca solo sus campos, todos opcionales", async () => {
    const fields = await fieldsFor("/users/:id", "PUT");
    expect(fields.map((f) => f.fieldName)).toEqual(["name", "age"]);
    expect(fields.every((f) => !f.required)).toBe(true);
  });
});
