import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import {
  SymfonyProjectScanner,
  SymfonyRouteScanner,
  SymfonyAttributesValidationProvider,
} from "../../projects/frameworks/scanners/symfony.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "symfony",
  fixtureRoot: comprehensiveFixture("symfony"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "composer.json": '{"require":{"symfony/framework-bundle":"^7.0"}}',
    "config/routes.yaml": 'vivo:\n  path: /vivo\n  controller: App\\\\Controller\\\\HealthController::check\n  methods: [GET]\n',
    "src/Controller/HealthController.php": "<?php\nnamespace App\\\\Controller;\nuse Symfony\\\\Component\\\\Routing\\\\Attribute\\\\Route;\nclass HealthController\n{\n    #[Route('/vivo', methods: ['GET'])]\n    public function check() {}\n}\n",
  },
  commentedEndpoint: {
    file: 'src/Controller/HealthController.php',
    source: "// #[Route('/endpoint-comentado', methods: ['GET'])]",
  },
});

const ROOT = smokeFixtureDir("symfony");
const COMPREHENSIVE = comprehensiveFixtureDir("symfony");

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

  test("comprehensive: detecta las 14 rutas con prefijos de controller class", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new SymfonyRouteScanner().scan(match);
    expect(routes.length).toBe(14);
  });

  test("no duplica endpoints declarados a la vez en YAML y en #[Route]", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new SymfonyRouteScanner().scan(match);
    const keys = routes.map((r) => `${r.method} ${r.uri}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("sourceFile es siempre relativo al proyecto", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new SymfonyRouteScanner().scan(match);
    for (const route of routes) {
      expect(route.sourceFile.startsWith("/")).toBe(false);
      expect(route.sourceFile).not.toContain("symfony-comprehensive");
    }
  });

  test("validation provider resuelve #[Assert\\NotBlank] para POST /users", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new SymfonyRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST" && r.uri === "/users");
    expect(post).toBeDefined();
    const provider = new SymfonyAttributesValidationProvider();
    const result = await provider.resolve(post!, match);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
    expect(names).toContain("age");
    expect(names).toContain("role");
  });

  test("validation provider resuelve los Assert del login (otro controller)", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new SymfonyRouteScanner().scan(match);
    const login = routes.find((r) => r.method === "POST" && r.uri === "/api/auth/login");
    expect(login).toBeDefined();
    const result = await new SymfonyAttributesValidationProvider().resolve(login!, match);
    expect(result.fields.map((f) => f.fieldName)).toEqual(["email", "password"]);
  });
});
