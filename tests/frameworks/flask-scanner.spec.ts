import { describe, expect, test } from "vitest";
import {
  FlaskProjectScanner,
  FlaskRouteScanner,
} from "../../packages/frameworks/scanners/flask.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "flask",
  fixtureRoot: comprehensiveFixture("flask"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "requirements.txt": 'flask\n',
    "app.py": "from flask import Flask\napp = Flask(__name__)\n\n@app.route('/vivo')\ndef vivo():\n    return {}\n",
  },
  commentedEndpoint: {
    file: 'app.py',
    source: "# @app.route('/endpoint-comentado')",
  },
});

const ROOT = smokeFixtureDir("flask");
const COMPREHENSIVE = comprehensiveFixtureDir("flask");

describe("Flask scanner", () => {
  test("detect() > 0 when requirements.txt contains 'flask'", async () => {
    expect((await new FlaskProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 when there is no requirements.txt", async () => {
    expect((await new FlaskProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() finds the 5 routes of the mini-fixture", async () => {
    const match = await new FlaskProjectScanner().resolve(ROOT);
    const routes = (await new FlaskRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(5);
  });

  test("GET /health, GET/POST /api/users, GET/DELETE /api/users/<int:id>", async () => {
    const match = await new FlaskProjectScanner().resolve(ROOT);
    const routes = (await new FlaskRouteScanner().scan(match)).routes;
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /health");
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/<int:id>");
    expect(pairs).toContain("DELETE /api/users/<int:id>");
  });

  test("path param <int:id> preserved as Flask defines it", async () => {
    const match = await new FlaskProjectScanner().resolve(ROOT);
    const routes = (await new FlaskRouteScanner().scan(match)).routes;
    const withId = routes.filter((r) => r.uri.includes("<int:id>"));
    expect(withId.length).toBe(2);
  });

  test("comprehensive: detects >13 routes with Blueprints", async () => {
    const match = await new FlaskProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new FlaskRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(13);
  });

  test("BluePrints apply url_prefix and real methods per module", async () => {
    const match = await new FlaskProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new FlaskRouteScanner().scan(match)).routes;
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);

    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("PATCH /api/orders/<int:id>/status");
    expect(pairs).toContain("POST /api/auth/login");
    expect(pairs).toContain("POST /api/auth/logout");
  });

  test("add_url_rule() is also parsed as a Flask route", async () => {
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
      const routes = (await new FlaskRouteScanner().scan(match)).routes;
      expect(routes.map((r) => `${r.method} ${r.uri}`)).toContain("GET /health");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("multi-method @app.route with methods=[GET, POST] produces two ParsedRoute", async () => {
    const match = await new FlaskProjectScanner().resolve(ROOT);
    const routes = (await new FlaskRouteScanner().scan(match)).routes;
    const userRoutes = routes.filter((r) => r.uri === "/api/users");
    expect(userRoutes.length).toBeGreaterThanOrEqual(2);
  });
});
