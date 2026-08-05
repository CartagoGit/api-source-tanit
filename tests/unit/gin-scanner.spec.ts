import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  GinProjectScanner,
  GinRouteScanner,
} from "../../service/scanners/gin.scanner";

const ROOT = resolve(import.meta.dir, "../../tests/smoke-fixtures/gin-mini");
const COMPREHENSIVE = resolve(import.meta.dir, "../../tests/fixtures/gin-comprehensive");

describe("Gin scanner", () => {
  test("detect() > 0 cuando go.mod tiene github.com/gin-gonic/gin", async () => {
    expect(await new GinProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay go.mod", async () => {
    expect(await new GinProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 5 rutas del mini-fixture", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = await new GinRouteScanner().scan(match);
    expect(routes).toHaveLength(5);
  });

  test("GET /health y CRUD /api/users presentes", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = await new GinRouteScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /health");
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/:id");
    expect(pairs).toContain("DELETE /api/users/:id");
  });

  test("path param Gin :id preservado en uri", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = await new GinRouteScanner().scan(match);
    const withId = routes.filter((r) => r.uri.endsWith(":id"));
    expect(withId.length).toBeGreaterThanOrEqual(2);
  });

  test("prefijo de Group /api aplicado a todas las subrutas", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = await new GinRouteScanner().scan(match);
    const apiRoutes = routes.filter((r) => r.uri.startsWith("/api"));
    expect(apiRoutes.length).toBeGreaterThanOrEqual(4);
  });

  test("comprehensive: detecta >13 rutas en multi-file Go", async () => {
    const match = await new GinProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new GinRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(13);
  });
});
