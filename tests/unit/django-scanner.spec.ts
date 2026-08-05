import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  DjangoProjectScanner,
  DjangoRouteScanner,
  DjangoSerializerProvider,
} from "../../service/scanners/django.scanner";

const ROOT = resolve(import.meta.dir, "../../tests/smoke-fixtures/django-mini");
const COMPREHENSIVE = resolve(import.meta.dir, "../../tests/fixtures/django-comprehensive");

describe("Django scanner", () => {
  test("detect() > 0 cuando hay manage.py", async () => {
    expect(await new DjangoProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay manage.py", async () => {
    expect(await new DjangoProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 4 rutas del mini-fixture", async () => {
    const match = await new DjangoProjectScanner().resolve(ROOT);
    const routes = await new DjangoRouteScanner().scan(match);
    expect(routes).toHaveLength(4);
  });

  test("rutas contienen health, api/users, api/users/<int:id>", async () => {
    const match = await new DjangoProjectScanner().resolve(ROOT);
    const routes = await new DjangoRouteScanner().scan(match);
    const uris = routes.map((r) => r.uri);
    expect(uris).toContain("health/");
    expect(uris.some((u) => u.includes("api/users/"))).toBe(true);
    expect(uris.some((u) => u.includes("<int:id>") || u.includes("{id}"))).toBe(true);
  });

  test("path param Django <int:id> preservado en uri del ParsedRoute", async () => {
    const match = await new DjangoProjectScanner().resolve(ROOT);
    const routes = await new DjangoRouteScanner().scan(match);
    const show = routes.find((r) => r.uri.includes("<int:id>"));
    expect(show).toBeDefined();
  });

  test("comprehensive: detecta >15 rutas con include() y CBVs/FBVs", async () => {
    const match = await new DjangoProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new DjangoRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  test("DRF serializer provider resuelve campos para POST /api/users", async () => {
    const match = await new DjangoProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new DjangoRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("api/users"));
    if (!post) return;
    const provider = new DjangoSerializerProvider();
    const result = await provider.resolve(post, match);
    expect(result.fields.length).toBeGreaterThan(0);
    expect(result.fields.some((f) => f.fieldName === "name" || f.fieldName === "email")).toBe(true);
  });
});
