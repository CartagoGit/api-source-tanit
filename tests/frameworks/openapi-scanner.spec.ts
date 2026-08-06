import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import {
  OpenApiProjectScanner,
  OpenApiScanner,
  OpenApiValidationProvider,
} from "../../service/scanners/openapi.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { moduleDir } from "../../helper/module-path.helper";

describeScannerContract({
  framework: "openapi",
  fixtureRoot: comprehensiveFixture("openapi"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: false,
  },
});

const ROOT = resolve(moduleDir(import.meta.url), "../../tests/smoke-fixtures/openapi-mini");
const COMPREHENSIVE = resolve(moduleDir(import.meta.url), "../../tests/fixtures/openapi-comprehensive");

describe("OpenAPI scanner", () => {
  test("detect() > 0 cuando hay openapi.yaml en la raíz", async () => {
    expect(await new OpenApiProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay archivo openapi/swagger", async () => {
    expect(await new OpenApiProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 4 rutas del mini-fixture (yaml)", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = await new OpenApiScanner().scan(match);
    expect(routes).toHaveLength(4);
  });

  test("GET /api/users, POST /api/users, GET /api/users/{id}, DELETE /api/users/{id}", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = await new OpenApiScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/{id}");
    expect(pairs).toContain("DELETE /api/users/{id}");
  });

  test("path param {id} de paths /api/users/{id} preservado", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = await new OpenApiScanner().scan(match);
    const withId = routes.filter((r) => r.uri.includes("{id}"));
    expect(withId.length).toBe(2);
  });

  test("OpenAPI validation provider resuelve campos de requestBody.schema para POST", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = await new OpenApiScanner().scan(match);
    const post = routes.find((r) => r.method === "POST");
    if (!post) return;
    const provider = new OpenApiValidationProvider();
    const result = await provider.resolve(post, match);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
  });

  // `IValidationSpec` separa el tipo lógico del formato semántico:
  // `format: email` en el spec OpenAPI es un string con formato email,
  // no un tipo "email" (que no existe en el contrato).
  test("campo email es string con format 'email'", async () => {
    const match = await new OpenApiProjectScanner().resolve(ROOT);
    const routes = await new OpenApiScanner().scan(match);
    const post = routes.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    const result = await new OpenApiValidationProvider().resolve(post!, match);
    const email = result.fields.find((f) => f.fieldName === "email");
    expect(email).toBeDefined();
    expect(email?.type).toBe("string");
    expect(email?.format).toBe("email");
  });

  test("comprehensive: detecta >20 rutas con $ref schemas y parámetros", async () => {
    const match = await new OpenApiProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new OpenApiScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(20);
  });
});
