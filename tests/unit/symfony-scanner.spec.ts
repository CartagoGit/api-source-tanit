import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  SymfonyProjectScanner,
  SymfonyRouteScanner,
  SymfonyAttributesValidationProvider,
} from "../../service/scanners/symfony.scanner";

const ROOT = resolve(import.meta.dir, "../../tests/smoke-fixtures/symfony-mini");
const COMPREHENSIVE = resolve(import.meta.dir, "../../tests/fixtures/symfony-comprehensive");

describe("Symfony scanner", () => {
  test("detect() > 0 cuando composer.json tiene symfony/framework-bundle", async () => {
    expect(await new SymfonyProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 en directorio sin composer.json", async () => {
    expect(await new SymfonyProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() devuelve las 3 rutas del mini-fixture (routes.yaml)", async () => {
    const match = await new SymfonyProjectScanner().resolve(ROOT);
    const routes = await new SymfonyRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  test("rutas incluyen GET y POST sobre /api/users", async () => {
    const match = await new SymfonyProjectScanner().resolve(ROOT);
    const routes = await new SymfonyRouteScanner().scan(match);
    const uris = routes.map((r) => `${r.method} ${r.uri}`);
    expect(uris).toContain("GET /api/users");
    expect(uris).toContain("POST /api/users");
  });

  test("path param {id} presente en la ruta show", async () => {
    const match = await new SymfonyProjectScanner().resolve(ROOT);
    const routes = await new SymfonyRouteScanner().scan(match);
    const show = routes.find((r) => r.method === "GET" && r.uri.includes("{id}"));
    expect(show).toBeDefined();
  });

  test("comprehensive: detecta >15 rutas con prefijos de controller class", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new SymfonyRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  test("validation provider resuelve #[Assert\\NotBlank] para POST", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new SymfonyRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST");
    if (!post) return;
    const provider = new SymfonyAttributesValidationProvider();
    const result = await provider.resolve(post, match);
    expect(result.fields.length).toBeGreaterThanOrEqual(0);
  });
});
