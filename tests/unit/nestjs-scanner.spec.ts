import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  NestJsProjectScanner,
  NestJsRouteScanner,
} from "../../service/scanners/nestjs.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";

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

const ROOT = resolve(import.meta.dir, "../../tests/smoke-fixtures/nestjs-mini");
const COMPREHENSIVE = resolve(import.meta.dir, "../../tests/fixtures/nestjs-comprehensive");

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
    for (const r of routes) expect(r.uri).toMatch(/^users/);
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
    expect(uris.some((u) => u.startsWith("users"))).toBe(true);
    expect(uris.some((u) => u.startsWith("orders"))).toBe(true);
    expect(uris.some((u) => u.startsWith("auth"))).toBe(true);
  });
});
