import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import {
  AspNetProjectScanner,
  AspNetRouteScanner,
  AspNetDataAnnotationsProvider,
} from "../../projects/frameworks/scanners/aspnet.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, scanProject } from "../helpers/scanner-fixture";
import { scannerBundleFor } from "../../projects/frameworks/framework.registry";
import { moduleDir } from "../../projects/core/helpers/module-path.helper";

describeScannerContract({
  framework: "aspnet",
  fixtureRoot: comprehensiveFixture("aspnet"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "demo.csproj": '<Project><ItemGroup><FrameworkReference Include="Microsoft.AspNetCore.App" /></ItemGroup></Project>',
    "Controllers/VivoController.cs": 'using Microsoft.AspNetCore.Mvc;\n\n[ApiController]\n[Route("vivo")]\npublic class VivoController : ControllerBase\n{\n    [HttpGet]\n    public IActionResult List() => Ok();\n}\n',
  },
  commentedEndpoint: {
    file: 'Controllers/VivoController.cs',
    source: '    // [HttpGet("endpoint-comentado")]',
  },
});

const ROOT = resolve(moduleDir(import.meta.url), "../../tests/smoke-fixtures/aspnet-mini");
const COMPREHENSIVE = resolve(moduleDir(import.meta.url), "../../tests/fixtures/aspnet-comprehensive");

describe("ASP.NET scanner", () => {
  test("detect() > 0 cuando hay un .csproj con Microsoft.AspNetCore", async () => {
    expect(await new AspNetProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay .csproj", async () => {
    expect(await new AspNetProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 4 rutas del mini-fixture", async () => {
    const match = await new AspNetProjectScanner().resolve(ROOT);
    const routes = await new AspNetRouteScanner().scan(match);
    expect(routes).toHaveLength(4);
  });

  test("[Route('api/users')] aplicado como prefijo de clase a todas las rutas", async () => {
    const match = await new AspNetProjectScanner().resolve(ROOT);
    const routes = await new AspNetRouteScanner().scan(match);
    for (const r of routes) expect(r.uri).toMatch(/api\/users/);
  });

  test("GET, POST, GET/{id}, DELETE/{id} todos presentes", async () => {
    const match = await new AspNetProjectScanner().resolve(ROOT);
    const routes = await new AspNetRouteScanner().scan(match);
    const methods = routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "GET", "POST"]);
  });

  test("[HttpGet('{id}')] → path param {id} en la uri", async () => {
    const match = await new AspNetProjectScanner().resolve(ROOT);
    const routes = await new AspNetRouteScanner().scan(match);
    const show = routes.find((r) => r.method === "GET" && r.uri.includes("{id}"));
    expect(show).toBeDefined();
  });

  test("comprehensive: detecta >10 rutas en multi-controller C#", async () => {
    const match = await new AspNetProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new AspNetRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  test("[FromBody] provider resuelve campos del modelo para POST", async () => {
    const match = await new AspNetProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new AspNetRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("users"));
    if (!post) return;
    const provider = new AspNetDataAnnotationsProvider();
    const result = await provider.resolve(post, match);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName.toLowerCase());
    expect(names).toContain("name");
    expect(names).toContain("email");
  });
});

describe("ASP.NET — minimal APIs (.NET 6+)", () => {
  const ROOT_MINIMAL = resolve(moduleDir(import.meta.url), "../../tests/fixtures/aspnet-comprehensive");

  // Es la forma por defecto desde .NET 6 (`dotnet new webapi`) y no la
  // cubría nada: un proyecto que solo las usara producía una colección
  // vacía.
  test("detecta app.MapGet en Program.cs", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    const health = routes.find((r) => r.uri === "/health");
    expect(health).toBeDefined();
    expect(health?.method).toBe("GET");
    expect(health?.sourceFile).toBe("Program.cs");
  });

  test("aplica el prefijo de MapGroup", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    const uris = routes.filter((r) => r.sourceFile === "Program.cs").map((r) => r.uri);
    expect(uris).toContain("/api/products");
    expect(uris).toContain("/api/products/{id}");
  });

  test("cubre los cinco verbos del grupo", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    const products = routes
      .filter((r) => r.uri.startsWith("/api/products"))
      .map((r) => r.method)
      .sort();
    expect(products).toEqual(["DELETE", "GET", "GET", "POST", "PUT"]);
  });

  test("un endpoint comentado no aparece", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    expect(routes.map((r) => r.uri).join(" ")).not.toContain("endpoint-comentado");
  });

  test("conviven minimal APIs y controladores en el mismo proyecto", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    expect(routes.some((r) => r.sourceFile === "Program.cs")).toBe(true);
    expect(routes.some((r) => r.sourceFile?.startsWith("Controllers/"))).toBe(true);
  });

  test("no duplica endpoints entre las dos formas", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    const keys = routes.map((r) => `${r.method} ${r.uri}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("ASP.NET — resolución del DTO por ruta", () => {
  const ROOT = resolve(moduleDir(import.meta.url), "../../tests/fixtures/aspnet-comprehensive");

  async function fieldsFor(method: string, uri: string): Promise<string[]> {
    const bundle = scannerBundleFor("aspnet")!;
    const { match, routes } = await scanProject("aspnet", ROOT);
    const route = routes.find((r) => r.method === method && r.uri === uri);
    expect(route).toBeDefined();
    const result = await bundle.validationProvider!.resolve(route!, match);
    return result.fields.map((f) => f.fieldName);
  }

  // Antes se buscaba el primer `[FromBody]` de TODO el fichero, así que
  // en un controlador con varios POST todos recibían el mismo DTO.
  test("dos endpoints del mismo controller usan cada uno su DTO", async () => {
    expect(await fieldsFor("POST", "/api/orders")).toEqual([
      "CustomerName",
      "CustomerEmail",
      "Amount",
      "Currency",
    ]);
    expect(await fieldsFor("PATCH", "/api/orders/{id}/status")).toEqual(["Status", "Note"]);
  });

  test("resuelve el DTO del parámetro tipado de un minimal API", async () => {
    expect(await fieldsFor("POST", "/api/products")).toEqual([
      "Name",
      "Price",
      "ContactEmail",
    ]);
  });

  test("los GET no reciben body", async () => {
    expect(await fieldsFor("GET", "/api/users")).toEqual([]);
    expect(await fieldsFor("GET", "/api/products")).toEqual([]);
  });

  test("los DELETE no reciben body", async () => {
    expect(await fieldsFor("DELETE", "/api/users/{id}")).toEqual([]);
  });

  test("un endpoint sin body declarado no inventa campos", async () => {
    expect(await fieldsFor("POST", "/api/auth/logout")).toEqual([]);
  });
});
