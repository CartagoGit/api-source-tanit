import { describe, expect, test } from "vitest";
import {
  AspNetProjectScanner,
  AspNetRouteScanner,
  AspNetDataAnnotationsProvider,
} from "../../packages/frameworks/scanners/aspnet.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, scanProject } from "../helpers/scanner-fixture";
import { scannerBundleFor } from "../../packages/frameworks/framework.registry";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";
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

const ROOT = smokeFixtureDir("aspnet");
const COMPREHENSIVE = comprehensiveFixtureDir("aspnet");

describe("ASP.NET scanner", () => {
  test("detect() > 0 when a .csproj with Microsoft.AspNetCore exists", async () => {
    expect((await new AspNetProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 when there is no .csproj", async () => {
    expect((await new AspNetProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() finds the 6 routes of the mini-fixture", async () => {
    const match = await new AspNetProjectScanner().resolve(ROOT);
    const routes = (await new AspNetRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(6);
  });

  test("[Route('api/users')] applied as class-level prefix to every route", async () => {
    const match = await new AspNetProjectScanner().resolve(ROOT);
    const routes = (await new AspNetRouteScanner().scan(match)).routes;
    for (const r of routes) expect(r.uri).toMatch(/api\/users/);
  });

  test("GET, POST, GET/{id}, DELETE/{id}, HEAD, OPTIONS all present", async () => {
    const match = await new AspNetProjectScanner().resolve(ROOT);
    const routes = (await new AspNetRouteScanner().scan(match)).routes;
    const methods = routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "GET", "HEAD", "OPTIONS", "POST"]);
  });

  test("[HttpGet('{id}')] → path param {id} in the uri", async () => {
    const match = await new AspNetProjectScanner().resolve(ROOT);
    const routes = (await new AspNetRouteScanner().scan(match)).routes;
    const show = routes.find((r) => r.method === "GET" && r.uri.includes("{id}"));
    expect(show).toBeDefined();
  });

  test("comprehensive: detects >10 routes in multi-controller C#", async () => {
    const match = await new AspNetProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new AspNetRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  test("[FromBody] provider resolves model fields for POST", async () => {
    const match = await new AspNetProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new AspNetRouteScanner().scan(match)).routes;
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("users"));
    if (!post) return;
    const provider = new AspNetDataAnnotationsProvider();
    const result = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName.toLowerCase());
    expect(names).toContain("name");
    expect(names).toContain("email");
  });
});

describe("ASP.NET — minimal APIs (.NET 6+)", () => {
  const ROOT_MINIMAL = comprehensiveFixtureDir("aspnet");

  // It is the default shape since .NET 6 (`dotnet new webapi`) and
  // nothing covered it: a project that only used them produced an
  // empty collection.
  test("detects app.MapGet in Program.cs", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    const health = routes.find((r) => r.uri === "/health");
    expect(health).toBeDefined();
    expect(health?.method).toBe("GET");
    expect(health?.sourceFile).toBe("Program.cs");
  });

  test("applies the MapGroup prefix", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    const uris = routes.filter((r) => r.sourceFile === "Program.cs").map((r) => r.uri);
    expect(uris).toContain("/api/products");
    expect(uris).toContain("/api/products/{id}");
  });

  test("covers all five group verbs", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    const products = routes
      .filter((r) => r.uri.startsWith("/api/products"))
      .map((r) => r.method)
      .sort();
    expect(products).toEqual(["DELETE", "GET", "GET", "POST", "PUT"]);
  });

  test("a commented endpoint does not appear", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    expect(routes.map((r) => r.uri).join(" ")).not.toContain("endpoint-comentado");
  });

  // a00011 C-6: `{id:int}` is vanilla ASP.NET. The constraint is
  // server-side documentation; in the collection the token is what
  // the user substitutes. Before the fix the URL came out literally
  // as `{id:int}` and Postman did not treat it as a path param.
  test("path constraint {id:int} is reduced to {id} (C-6 a00011)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Tienda.csproj": `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>
</Project>`,
      "Program.cs": `var app = builder.Build();
app.MapGet("/productos/{id:int}", (int id) => id);
app.MapGet("/clientes/{slug:alpha}", (string slug) => slug);
app.MapPut("/pedidos/{id:guid}", (Guid id) => id);
app.Run();`,
    });
    const match = await new AspNetProjectScanner().resolve(project.root);
    const routes = (await new AspNetRouteScanner().scan(match)).routes;
    const uris = routes.map((r) => r.uri).sort();
    expect(uris).toEqual(["/clientes/{slug}", "/pedidos/{id}", "/productos/{id}"]);
    await project.cleanup();
  });

  test("[controller] token is resolved to the derived name (C-6 a00011)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Tienda.csproj": `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`,
      "Controllers/UsersController.cs": `using Microsoft.AspNetCore.Mvc;
namespace Tienda;
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
  [HttpGet]
  public System.Collections.Generic.IEnumerable<string> List() => System.Array.Empty<string>();
}`,
    });
    const match = await new AspNetProjectScanner().resolve(project.root);
    const routes = (await new AspNetRouteScanner().scan(match)).routes;
    const uris = routes.map((r) => r.uri);
    expect(uris).toContain("/api/users");
    expect(uris.every((u) => !u.includes("[controller]"))).toBe(true);
    await project.cleanup();
  });

  test("minimal APIs and controllers coexist in the same project", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    expect(routes.some((r) => r.sourceFile === "Program.cs")).toBe(true);
    expect(routes.some((r) => r.sourceFile?.startsWith("Controllers/"))).toBe(true);
  });

  test("does not duplicate endpoints across the two shapes", async () => {
    const { routes } = await scanProject("aspnet", ROOT_MINIMAL);
    const keys = routes.map((r) => `${r.method} ${r.uri}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("ASP.NET — per-route DTO resolution", () => {
  const ROOT = comprehensiveFixtureDir("aspnet");

  async function fieldsFor(method: string, uri: string): Promise<string[]> {
    const bundle = scannerBundleFor("aspnet")!;
    const { match, routes } = await scanProject("aspnet", ROOT);
    const route = routes.find((r) => r.method === method && r.uri === uri);
    expect(route).toBeDefined();
    const result = await bundle.validationProvider!.resolve(route!, match, EMPTY_SCAN_RESULT);
    return result.fields.map((f) => f.fieldName);
  }

  // Previously it looked up the first `[FromBody]` of the entire
  // file, so a controller with multiple POSTs all received the same
  // DTO.
  test("two endpoints in the same controller each use their own DTO", async () => {
    expect(await fieldsFor("POST", "/api/orders")).toEqual([
      "CustomerName",
      "CustomerEmail",
      "Amount",
      "Currency",
    ]);
    expect(await fieldsFor("PATCH", "/api/orders/{id}/status")).toEqual(["Status", "Note"]);
  });

  test("resolves the DTO of a minimal API's typed parameter", async () => {
    expect(await fieldsFor("POST", "/api/products")).toEqual([
      "Name",
      "Price",
      "ContactEmail",
    ]);
  });

  test("GETs do not receive a body", async () => {
    expect(await fieldsFor("GET", "/api/users")).toEqual([]);
    expect(await fieldsFor("GET", "/api/products")).toEqual([]);
  });

  test("DELETEs do not receive a body", async () => {
    expect(await fieldsFor("DELETE", "/api/users/{id}")).toEqual([]);
  });

  test("an endpoint without a declared body does not invent fields", async () => {
    expect(await fieldsFor("POST", "/api/auth/logout")).toEqual([]);
  });
});

describe("ASP.NET — full HTTP method coverage (x00036)", () => {
  // Antes de x00036, `[HttpHead]` y `[HttpOptions]` se detectaban en la
  // regex METHOD_ATTR_RE pero el array `HTTP_METHODS` (línea 17 de
  // aspnet.scanner.ts) solo admitía los cinco verbos principales, así
  // que las rutas se descartaban en silencio. El usuario recibía una
  // colección Postman sin HEAD ni OPTIONS — los healthchecks de K8s y
  // los prefights de CORS quedaban fuera sin warning.
  test("[HttpHead] produces a HEAD endpoint (controller style)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Demo.csproj": `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup><PackageReference Include="Microsoft.AspNetCore.App" /></ItemGroup>
</Project>`,
      "Controllers/HealthController.cs": `using Microsoft.AspNetCore.Mvc;
[ApiController]
[Route("api/health")]
public class HealthController : ControllerBase
{
  [HttpHead]
  public IActionResult Ping() => Ok();
}`,
    });
    try {
      const match = await new AspNetProjectScanner().resolve(project.root);
      const routes = (await new AspNetRouteScanner().scan(match)).routes;
      const head = routes.find((r) => r.method === "HEAD");
      expect(head).toBeDefined();
      expect(head?.uri).toBe("/api/health");
    } finally {
      await project.cleanup();
    }
  });

  test("[HttpOptions] produces an OPTIONS endpoint (controller style)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Demo.csproj": `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup><PackageReference Include="Microsoft.AspNetCore.App" /></ItemGroup>
</Project>`,
      "Controllers/CorsController.cs": `using Microsoft.AspNetCore.Mvc;
[ApiController]
[Route("api/cors")]
public class CorsController : ControllerBase
{
  [HttpOptions]
  public IActionResult Preflight() => Ok();
}`,
    });
    try {
      const match = await new AspNetProjectScanner().resolve(project.root);
      const routes = (await new AspNetRouteScanner().scan(match)).routes;
      const options = routes.find((r) => r.method === "OPTIONS");
      expect(options).toBeDefined();
      expect(options?.uri).toBe("/api/cors");
    } finally {
      await project.cleanup();
    }
  });

  test("app.MapHead produces a HEAD endpoint (minimal API style)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Demo.csproj": `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
      "Program.cs": `var app = WebApplication.CreateBuilder(args).Build();
app.MapHead("/api/ping", () => Results.Ok());
app.Run();`,
    });
    try {
      const match = await new AspNetProjectScanner().resolve(project.root);
      const routes = (await new AspNetRouteScanner().scan(match)).routes;
      const head = routes.find((r) => r.method === "HEAD");
      expect(head).toBeDefined();
      expect(head?.uri).toBe("/api/ping");
    } finally {
      await project.cleanup();
    }
  });

  test("app.MapOptions produces an OPTIONS endpoint (minimal API style)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Demo.csproj": `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
      "Program.cs": `var app = WebApplication.CreateBuilder(args).Build();
app.MapOptions("/api/preflight", () => Results.Ok());
app.Run();`,
    });
    try {
      const match = await new AspNetProjectScanner().resolve(project.root);
      const routes = (await new AspNetRouteScanner().scan(match)).routes;
      const options = routes.find((r) => r.method === "OPTIONS");
      expect(options).toBeDefined();
      expect(options?.uri).toBe("/api/preflight");
    } finally {
      await project.cleanup();
    }
  });

  test("the five original verbs do not regress", async () => {
    // Si alguien vuelve a estrechar HTTP_METHODS, este test lo coge
    // aunque ningún endpoint use los verbos nuevos.
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "Demo.csproj": `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`,
      "Controllers/UsersController.cs": `using Microsoft.AspNetCore.Mvc;
[ApiController]
[Route("api/users")]
public class UsersController : ControllerBase
{
  [HttpGet] public object List() => new[] { 1, 2 };
  [HttpPost] public object Create() => new { };
  [HttpPut("{id}")] public object Update(string id) => new { };
  [HttpDelete("{id}")] public object Delete(string id) => new { };
  [HttpPatch("{id}")] public object Patch(string id) => new { };
}`,
    });
    try {
      const match = await new AspNetProjectScanner().resolve(project.root);
      const routes = (await new AspNetRouteScanner().scan(match)).routes;
      const methods = routes.map((r) => r.method).sort();
      expect(methods).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
    } finally {
      await project.cleanup();
    }
  });
});
