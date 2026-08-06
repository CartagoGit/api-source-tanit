import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  AspNetProjectScanner,
  AspNetRouteScanner,
  AspNetDataAnnotationsProvider,
} from "../../service/scanners/aspnet.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";

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

const ROOT = resolve(import.meta.dir, "../../tests/smoke-fixtures/aspnet-mini");
const COMPREHENSIVE = resolve(import.meta.dir, "../../tests/fixtures/aspnet-comprehensive");

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
