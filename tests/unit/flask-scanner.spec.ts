import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  FlaskProjectScanner,
  FlaskRouteScanner,
} from "../../service/scanners/flask.scanner";

const ROOT = resolve(import.meta.dir, "../../tests/smoke-fixtures/flask-mini");
const COMPREHENSIVE = resolve(import.meta.dir, "../../tests/fixtures/flask-comprehensive");

describe("Flask scanner", () => {
  test("detect() > 0 cuando requirements.txt tiene 'flask'", async () => {
    expect(await new FlaskProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay requirements.txt", async () => {
    expect(await new FlaskProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 5 rutas del mini-fixture", async () => {
    const match = await new FlaskProjectScanner().resolve(ROOT);
    const routes = await new FlaskRouteScanner().scan(match);
    expect(routes).toHaveLength(5);
  });

  test("GET /health, GET/POST /api/users, GET/DELETE /api/users/<int:id>", async () => {
    const match = await new FlaskProjectScanner().resolve(ROOT);
    const routes = await new FlaskRouteScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /health");
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/<int:id>");
    expect(pairs).toContain("DELETE /api/users/<int:id>");
  });

  test("path param <int:id> preservado como lo define Flask", async () => {
    const match = await new FlaskProjectScanner().resolve(ROOT);
    const routes = await new FlaskRouteScanner().scan(match);
    const withId = routes.filter((r) => r.uri.includes("<int:id>"));
    expect(withId.length).toBe(2);
  });

  test("comprehensive: detecta >13 rutas con Blueprints", async () => {
    const match = await new FlaskProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new FlaskRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(13);
  });

  test("BluePrints aplican url_prefix y métodos reales por módulo", async () => {
    const match = await new FlaskProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new FlaskRouteScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);

    expect(pairs).toContain("GET /api/users/");
    expect(pairs).toContain("POST /api/users/");
    expect(pairs).toContain("PATCH /api/orders/<int:id>/status");
    expect(pairs).toContain("POST /api/auth/login");
    expect(pairs).toContain("POST /api/auth/logout");
  });

  test("add_url_rule() también se parsea como ruta Flask", async () => {
    const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dir = await mkdtemp(join(tmpdir(), "flask-add-url-rule-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "requirements.txt"),
      "flask>=3.0\n",
      "utf8",
    );
    await writeFile(
      join(dir, "app.py"),
      `from flask import Flask\n\napp = Flask(__name__)\napp.add_url_rule('/health', view_func=lambda: {'ok': True}, methods=['GET'])\n`,
      "utf8",
    );

    try {
      const match = await new FlaskProjectScanner().resolve(dir);
      const routes = await new FlaskRouteScanner().scan(match);
      expect(routes.map((r) => `${r.method} ${r.uri}`)).toContain("GET /health");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("multi-method @app.route con methods=[GET, POST] produce dos ParsedRoute", async () => {
    const match = await new FlaskProjectScanner().resolve(ROOT);
    const routes = await new FlaskRouteScanner().scan(match);
    const userRoutes = routes.filter((r) => r.uri === "/api/users");
    expect(userRoutes.length).toBeGreaterThanOrEqual(2);
  });
});
