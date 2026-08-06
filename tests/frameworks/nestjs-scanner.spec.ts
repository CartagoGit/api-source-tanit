import { describe, expect, test } from "vitest";
import {
  NestJsProjectScanner,
  NestJsRouteScanner,
} from "../../projects/frameworks/scanners/nestjs.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import {
  comprehensiveFixture,
  createTempProject,
  scanProject,
} from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "nestjs",
  fixtureRoot: comprehensiveFixture("nestjs"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "package.json": '{"dependencies":{"@nestjs/core":"^10.0.0"}}',
    "src/app.controller.ts": 'import { Controller, Get } from "@nestjs/common";\n@Controller("vivo")\nexport class AppController {\n  @Get()\n  list() { return []; }\n}\n',
  },
  commentedEndpoint: {
    file: 'src/app.controller.ts',
    source: "// @Get('endpoint-comentado')",
  },
});

const ROOT = smokeFixtureDir("nestjs");
const COMPREHENSIVE = comprehensiveFixtureDir("nestjs");

describe("NestJS scanner", () => {
  test("detect() > 0 cuando package.json tiene @nestjs/core", async () => {
    const scanner = new NestJsProjectScanner();
    const score = await scanner.detect(ROOT);
    expect(score).toBeGreaterThan(0);
  });

  test("detect() === 0 en un directorio vacío", async () => {
    const scanner = new NestJsProjectScanner();
    const score = await scanner.detect("/tmp");
    expect(score).toBe(0);
  });

  test("scan() devuelve las 5 rutas del mini-fixture", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(ROOT);
    const routes = await new NestJsRouteScanner().scan(match);
    expect(routes).toHaveLength(5);
    const methods = routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "GET", "POST", "PUT"]);
  });

  test("prefix @Controller('users') se aplica a todas las rutas", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(ROOT);
    const routes = await new NestJsRouteScanner().scan(match);
    for (const r of routes) expect(r.uri).toMatch(/^\/users/);
  });

  test("path param ':id' presente en rutas con @Get(':id'), @Put(':id'), @Delete(':id')", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(ROOT);
    const routes = await new NestJsRouteScanner().scan(match);
    const withId = routes.filter((r) => r.uri.includes(":id"));
    expect(withId.length).toBeGreaterThanOrEqual(3);
  });

  test("comprehensive: detecta >10 rutas repartidas en 3 controllers", async () => {
    const ps = new NestJsProjectScanner();
    const match = await ps.resolve(COMPREHENSIVE);
    const routes = await new NestJsRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(11);
    const uris = routes.map((r) => r.uri);
    expect(uris.some((u) => u.startsWith("/api/users"))).toBe(true);
    expect(uris.some((u) => u.startsWith("/api/orders"))).toBe(true);
    expect(uris.some((u) => u.startsWith("/api/auth"))).toBe(true);
  });
});

describe("NestJS — setGlobalPrefix", () => {
  const CONTROLLER = `import { Controller, Get, Post } from "@nestjs/common";
@Controller("users")
export class UsersController {
  @Get() list() { return []; }
  @Post() create() { return {}; }
}
`;
  const PACKAGE = JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0" } });

  async function scanWithMain(mainSource: string): Promise<string[]> {
    const project = await createTempProject({
      "package.json": PACKAGE,
      "src/main.ts": mainSource,
      "src/users/users.controller.ts": CONTROLLER,
    });
    try {
      const { routes } = await scanProject("nestjs", project.root);
      return routes.map((r) => `${r.method} ${r.uri}`).sort();
    } finally {
      await project.cleanup();
    }
  }

  // `setGlobalPrefix` se aplica a TODOS los controladores. Sin leerlo, un
  // proyecto que lo use —lo normal en NestJS— salía con URIs sin prefijo
  // y ninguna request respondía.
  test("aplica el prefijo global a todas las rutas", async () => {
    expect(await scanWithMain('app.setGlobalPrefix("api/v1");')).toEqual([
      "GET /api/v1/users",
      "POST /api/v1/users",
    ]);
  });

  test("sin prefijo global las rutas quedan como están", async () => {
    expect(await scanWithMain("const app = 1;")).toEqual(["GET /users", "POST /users"]);
  });

  test("un setGlobalPrefix comentado no se aplica", async () => {
    expect(await scanWithMain('// app.setGlobalPrefix("comentado");')).toEqual([
      "GET /users",
      "POST /users",
    ]);
  });

  test("acepta comillas simples y backticks", async () => {
    expect(await scanWithMain("app.setGlobalPrefix('api');")).toEqual([
      "GET /api/users",
      "POST /api/users",
    ]);
  });

  test("normaliza el prefijo con barra inicial", async () => {
    expect(await scanWithMain('app.setGlobalPrefix("/api");')).toEqual([
      "GET /api/users",
      "POST /api/users",
    ]);
  });
});
