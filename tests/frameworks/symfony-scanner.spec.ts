import { describe, expect, test } from "vitest";
import {
  SymfonyProjectScanner,
  SymfonyRouteScanner,
  SymfonyAttributesValidationProvider,
} from "../../packages/frameworks/scanners/symfony.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, createTempProject, scanProject } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";
import type { ParsedRoute } from "../../packages/contracts/interfaces/core/scanner.interface";

import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";
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
  test("detect() > 0 when composer.json contains symfony/framework-bundle", async () => {
    expect((await new SymfonyProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 in a directory without composer.json", async () => {
    expect((await new SymfonyProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() returns the 3 routes of the mini-fixture (routes.yaml)", async () => {
    const match = await new SymfonyProjectScanner().resolve(ROOT);
    const routes = (await new SymfonyRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  test("routes include GET and POST on /api/users", async () => {
    const match = await new SymfonyProjectScanner().resolve(ROOT);
    const routes = (await new SymfonyRouteScanner().scan(match)).routes;
    const uris = routes.map((r) => `${r.method} ${r.uri}`);
    expect(uris).toContain("GET /api/users");
    expect(uris).toContain("POST /api/users");
  });

  test("path param {id} present in the show route", async () => {
    const match = await new SymfonyProjectScanner().resolve(ROOT);
    const routes = (await new SymfonyRouteScanner().scan(match)).routes;
    const show = routes.find((r) => r.method === "GET" && r.uri.includes("{id}"));
    expect(show).toBeDefined();
  });

  test("comprehensive: detects the 14 routes with controller class prefixes", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new SymfonyRouteScanner().scan(match)).routes;
    expect(routes.length).toBe(14);
  });

  test("does not duplicate endpoints declared in both YAML and #[Route]", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new SymfonyRouteScanner().scan(match)).routes;
    const keys = routes.map((r) => `${r.method} ${r.uri}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("sourceFile is always relative to the project", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new SymfonyRouteScanner().scan(match)).routes;
    for (const route of routes) {
      expect(route.sourceFile.startsWith("/")).toBe(false);
      expect(route.sourceFile).not.toContain("symfony-comprehensive");
    }
  });

  test("validation provider resolves #[Assert\\NotBlank] for POST /users", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new SymfonyRouteScanner().scan(match)).routes;
    const post = routes.find((r) => r.method === "POST" && r.uri === "/users");
    expect(post).toBeDefined();
    const provider = new SymfonyAttributesValidationProvider();
    const result = await provider.resolve(post!, match, EMPTY_SCAN_RESULT);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
    expect(names).toContain("age");
    expect(names).toContain("role");
  });

  test("validation provider resolves the Assert from login (another controller)", async () => {
    const match = await new SymfonyProjectScanner().resolve(COMPREHENSIVE);
    const result = await new SymfonyRouteScanner().scan(match);
    const routes = result.routes;
    const login = routes.find((r) => r.method === "POST" && r.uri === "/api/auth/login");
    expect(login).toBeDefined();
    const validation = await new SymfonyAttributesValidationProvider().resolve(
      login!,
      match,
      result,
    );
    expect(validation.fields.map((f) => f.fieldName)).toEqual(["email", "password"]);
  });
});

// ---------------------------------------------------------------------------
// Detection: variantes de composer.json / marcadores.
// ---------------------------------------------------------------------------

describe("Symfony detect — variants", () => {
  test("require-dev also counts as Symfony", async () => {
    const project = await createTempProject({
      "composer.json": '{"require-dev":{"symfony/routing":"^7.0"}}',
      "config/routes.yaml": "vivo:\n  path: /vivo\n  controller: C::v\n  methods: [GET]\n",
    });
    try {
      // No bin/console nor src/Controller but yes routes.yaml → 0.8.
      expect((await new SymfonyProjectScanner().detect(project.root)).score).toBe(0.7);
    } finally {
      await project.cleanup();
    }
  });

  test("only composer.json with Symfony scores 0.4", async () => {
    const project = await createTempProject({
      "composer.json": '{"require":{"symfony/framework-bundle":"^7.0"}}',
    });
    try {
      expect((await new SymfonyProjectScanner().detect(project.root)).score).toBe(0.6);
    } finally {
      await project.cleanup();
    }
  });

  test("corrupt composer.json scores 0", async () => {
    const project = await createTempProject({
      "composer.json": "{json roto",
    });
    try {
      expect((await new SymfonyProjectScanner().detect(project.root)).score).toBe(0);
    } finally {
      await project.cleanup();
    }
  });

  test("without a require section in composer.json does not throw and scores 0", async () => {
    const project = await createTempProject({
      "composer.json": '{"name":"sin-dependencias"}',
    });
    try {
      expect((await new SymfonyProjectScanner().detect(project.root)).score).toBe(0);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Rutas YAML: prefix, methods como string, resource y entradas raras.
// ---------------------------------------------------------------------------

const COMPOSER = '{"require":{"symfony/framework-bundle":"^7.0"}}';

describe("Symfony — YAML routes", () => {
  test("prefix concatenates and controller::action goes into actionName", async () => {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml": [
        "con_prefijo:",
        "  path: /p",
        "  controller: App\\Controller\\C::m",
        "  methods: [GET]",
        "  prefix: /api",
        "string_methods:",
        "  path: /s",
        "  controller: App\\Controller\\C::s",
        "  methods: GET",
        "sin_controller:",
        "  path: /k",
        "  methods: [GET]",
        "no_es_objeto: solo-un-string",
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("symfony", project.root);
      const prefijo = routes.find((r) => r.uri === "/api/p");
      expect(prefijo).toBeDefined();
      expect(prefijo?.prefixChain).toEqual(["/api"]);
      expect(prefijo?.displayName).toBe("con_prefijo");
      expect(prefijo?.controllerClass).toBe("App\\Controller\\C");
      expect(prefijo?.description).toBeUndefined();
      // methods as string: split on | or , without leaking into description.
      const str = routes.find((r) => r.uri === "/s");
      expect(str?.method).toBe("GET");
      expect(str?.description).toBeUndefined();
      expect(str?.actionName).toBe("s");
      // Neither a missing controller nor a scalar entry produce anything.
      expect(routes).toHaveLength(2);
    } finally {
      await project.cleanup();
    }
  });

  test("methods string with several verbs separated by |", async () => {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml": [
        "doble:",
        "  path: /d",
        "  controller: App\\Controller\\C::d",
        "  methods: GET|POST",
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("symfony", project.root);
      expect(routes.map((r) => r.method).sort()).toEqual(["GET", "POST"]);
    } finally {
      await project.cleanup();
    }
  });

  test("non-HTTP verbs in a methods string are dropped", async () => {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml": [
        "raro:",
        "  path: /r",
        "  controller: App\\Controller\\C::r",
        "  methods: PURGE,GET",
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("symfony", project.root);
      expect(routes.map((r) => r.method)).toEqual(["GET"]);
    } finally {
      await project.cleanup();
    }
  });

  test("resource: pointing to a controller is parsed with prefix", async () => {
    const controller = [
      "<?php",
      "namespace App\\Controller;",
      "#[Route('/widgets')]",
      "class WidgetController",
      "{",
      "    #[Route('', name: 'widgets_index')]",
      "    public function index() {}",
      "",
      "    #[Route('/{id}', methods: ['GET'])]",
      "    public function show() {}",
      "}",
    ].join("\n");
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml": [
        "widgets_attr:",
        "  resource: ./src/Controller/WidgetController.php",
        "  prefix: /api",
      ].join("\n"),
      "src/Controller/WidgetController.php": controller,
    });
    try {
      const { routes } = await scanProject("symfony", project.root);
      const uris = routes.map((r) => r.uri).sort();
      expect(uris).toEqual(["/api/widgets", "/api/widgets/{id}"]);
      // The prefix comes from the YAML plus the class-level #[Route].
      expect(routes[0]?.prefixChain).toEqual(["/api/widgets"]);
      // Relative sourceFile: the historic Symfony bug.
      expect(routes[0]?.sourceFile).toBe("src/Controller/WidgetController.php");
    } finally {
      await project.cleanup();
    }
  });

  test("resource in config/routes is resolved relative to the YAML", async () => {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml": "imports:\n  resource: ./routes/api.yaml\n",
      "config/routes/api.yaml": [
        "widgets:",
        "  resource: ../../src/Controller/WidgetController.php",
      ].join("\n"),
      "src/Controller/WidgetController.php": [
        "<?php",
        "namespace App\\Controller;",
        "use Symfony\\Component\\Routing\\Attribute\\Route;",
        "class WidgetController",
        "{",
        "    #[Route('/widgets', methods: ['GET'])]",
        "    public function list() {}",
        "}",
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("symfony", project.root);
      expect(routes.map((route) => route.uri)).toContain("/widgets");
    } finally {
      await project.cleanup();
    }
  });

  test("resource that is not a string and resource without Controller.php yield nothing", async () => {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml": [
        "resource_lista:",
        "  resource: [a, b]",
        "resource_otro:",
        "  resource: ../src/Service/NoController.php",
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("symfony", project.root);
      expect(routes).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });

  test("config/routes/: only .yaml/.yml, the rest is ignored", async () => {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml": "raiz:\n  path: /raiz\n  controller: C::r\n  methods: [GET]\n",
      "config/routes/sub.yml": "yml:\n  path: /yml\n  controller: C::y\n  methods: [GET]\n",
      "config/routes/readme.txt": "nada",
    });
    try {
      const { routes } = await scanProject("symfony", project.root);
      expect(routes.map((r) => r.uri).sort()).toEqual(["/raiz", "/yml"]);
    } finally {
      await project.cleanup();
    }
  });

  test("YAML without a root mapping produces no routes and does not throw", async () => {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml": "- solo\n- lista\n",
    });
    try {
      const { routes } = await scanProject("symfony", project.root);
      expect(routes).toEqual([]);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// #[Route] attributes: method variants and dedupe with YAML.
// ---------------------------------------------------------------------------

describe("Symfony — #[Route] attributes", () => {
  function controllerPhp(body: string): string {
    return [
      "<?php",
      "namespace App\\Controller;",
      "#[Route('/base')]",
      "class EdgeController",
      "{",
      body,
      "}",
    ].join("\n");
  }

  async function escanear(cuerpoController: string) {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "src/Controller/EdgeController.php": controllerPhp(cuerpoController),
    });
    try {
      return await scanProject("symfony", project.root);
    } finally {
      await project.cleanup();
    }
  }

  test("name, single-string methods, and default verbs", async () => {
    const { routes } = await escanear([
      "    #[Route('/n', methods: ['GET'], name: 'con_nombre')]",
      "    public function conNombre() {}",
      "",
      "    #[Route('/uno', methods: 'POST')]",
      "    public function uno() {}",
      "",
      "    #[Route('/sin-metodo')]",
      "    public function sinMetodo() {}",
    ].join("\n"));
    const conNombre = routes.find((r) => r.uri === "/base/n");
    expect(conNombre?.displayName).toBe("con_nombre");
    expect(conNombre?.description).toBe("conNombre");
    expect(conNombre?.prefixChain).toEqual(["/base"]);
    const uno = routes.find((r) => r.uri === "/base/uno");
    expect(uno?.method).toBe("POST");
    // Without declared methods: Symfony answers GET.
    const sinMetodo = routes.find((r) => r.method === "GET" && r.uri === "/base/sin-metodo");
    expect(sinMetodo).toBeDefined();
  });

  test("unknown verb is dropped and the signature at +3 lines still yields a name", async () => {
    const { routes } = await escanear([
      "    #[Route('/purga', methods: ['PURGE'])]",
      "    public function purga() {}",
      "",
      "    #[Route('/lejana', methods: ['GET'])]",
      "    // comentario",
      "",
      "    public function lejana() {}",
      "",
      "    #[Route('/sin-firma', methods: ['GET'])]",
    ].join("\n"));
    expect(routes.some((r) => r.uri === "/base/purga")).toBe(false);
    const lejana = routes.find((r) => r.uri === "/base/lejana");
    expect(lejana?.description).toBe("lejana");
    // Without a signature in the 3 lines that follow: derived displayName.
    const sinFirma = routes.find((r) => r.uri === "/base/sin-firma");
    expect(sinFirma?.displayName).toBe("GET /base/sin-firma");
    expect(sinFirma?.description).toBeUndefined();
  });

  test("dedupe: YAML + #[Route] keep the attribute one (more informative)", async () => {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml":
        "dup:\n  path: /dup\n  controller: App\\Controller\\DupController::action\n  methods: [GET]\n",
      "src/Controller/DupController.php": [
        "<?php",
        "class DupController",
        "{",
        "    #[Route('/dup', methods: ['GET'])]",
        "    public function action() {}",
        "}",
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("symfony", project.root);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.lineNumber).toBeGreaterThan(0);
      expect(routes[0]?.description).toBe("action");
    } finally {
      await project.cleanup();
    }
  });

  test("dedupe at the root ('/') does not collapse extra slashes", async () => {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml": "raiz:\n  path: /\n  controller: C::root\n  methods: [GET]\n",
      "src/Controller/RootController.php": [
        "<?php",
        "class RootController",
        "{",
        "    #[Route('/', methods: ['GET'])]",
        "    public function root() {}",
        "}",
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("symfony", project.root);
      expect(routes.map((r) => `${r.method} ${r.uri}`)).toEqual(["GET /"]);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// SymfonyAttributesValidationProvider: ramas del extractor de #[Assert].
// ---------------------------------------------------------------------------

describe("Symfony — assertions provider", () => {
  test("YAML controller::action resolves the method's assertions", async () => {
    const project = await createTempProject({
      "composer.json": COMPOSER,
      "config/routes.yaml": [
        "create:",
        "  path: /orders",
        "  controller: App\\Controller\\OrderController::create",
        "  methods: [POST]",
      ].join("\n"),
      "src/Controller/OrderController.php": [
        "<?php",
        "namespace App\\Controller;",
        "use Symfony\\Component\\Validator\\Constraints as Assert;",
        "class OrderController",
        "{",
        "    public function create(#[Assert\\NotBlank] string $reference) {}",
        "}",
      ].join("\n"),
    });
    try {
      const { match, routes } = await scanProject("symfony", project.root);
      const route = routes.find((item) => item.uri === "/orders")!;
      const provider = new SymfonyAttributesValidationProvider();
      const result = await provider.resolve(route, match, EMPTY_SCAN_RESULT);
      expect(result.fields.map((field) => field.fieldName)).toContain("reference");
    } finally {
      await project.cleanup();
    }
  });
  const provider = new SymfonyAttributesValidationProvider();

  test("every Assert kind: format, bounds, enum and allowNull", async () => {
    const proyecto = await createTempProject({
      "composer.json": COMPOSER,
      "src/Controller/AssertController.php": [
        "<?php",
        "class AssertController",
        "{",
        "    #[Route('/create', methods: ['POST'])]",
        "    public function create(",
        "        #[Assert\\NotBlank] string $name,",
        "        #[Assert\\Email] string $email,",
        "        #[Assert\\Length(min: 2, max: 60)] string $title,",
        "        #[Assert\\Choice(choices: ['a', 'b'])] string $role,",
        "        #[Assert\\Range(min: 0, max: 100)] int $age,",
        "        #[Assert\\NotNull(allowNull: true)] string $opt,",
        "        #[Assert\\Inventado] string $raro,",
        "    ) { return 1; }",
        "}",
      ].join("\n"),
    });
    try {
      const { match, routes } = await scanProject("symfony", proyecto.root);
      const post = routes.find((r) => r.method === "POST");
      expect(post).toBeDefined();
      const result = await provider.resolve(post!, match, EMPTY_SCAN_RESULT);
      const byName = new Map(result.fields.map((f) => [f.fieldName, f]));
      expect(byName.get("name")).toMatchObject({ type: "string", required: true });
      expect(byName.get("email")).toMatchObject({ type: "string", format: "email" });
      expect(byName.get("title")).toMatchObject({ minLength: 2, maxLength: 60 });
      expect(byName.get("role")).toMatchObject({ type: "enum", enumValues: ["a", "b"] });
      expect(byName.get("age")).toMatchObject({ type: "integer", minimum: 0, maximum: 100 });
      expect(byName.get("opt")).toMatchObject({ required: false });
      // An unknown Assert yields no field.
      expect(byName.has("raro")).toBe(false);
    } finally {
      await proyecto.cleanup();
    }
  });

  test("Assert on a separate line from the parameter (3-line search)", async () => {
    const proyecto = await createTempProject({
      "composer.json": COMPOSER,
      "src/Controller/SeparadoController.php": [
        "<?php",
        "class SeparadoController",
        "{",
        "    #[Route('/sep', methods: ['POST'])]",
        "    public function sep(",
        "        #[Assert\\NotBlank]",
        "        string $nombre,",
        "    ) { return 1; }",
        "}",
      ].join("\n"),
    });
    try {
      const { match, routes } = await scanProject("symfony", proyecto.root);
      const result = await provider.resolve(routes.find((r) => r.method === "POST")!, match, EMPTY_SCAN_RESULT);
      expect(result.fields.map((f) => f.fieldName)).toEqual(["nombre"]);
    } finally {
      await proyecto.cleanup();
    }
  });

  test("YAML route without #[Route]: locates the method by description", async () => {
    const proyecto = await createTempProject({
      "composer.json": COMPOSER,
      "src/Controller/YamlController.php": [
        "<?php",
        "class YamlController",
        "{",
        "    public function accion(",
        "        #[Assert\\NotBlank] string $campo,",
        "    ) { return 1; }",
        "}",
      ].join("\n"),
    });
    try {
      const match = await new SymfonyProjectScanner().resolve(proyecto.root);
      const rutaYaml: ParsedRoute = {
        method: "POST",
        uri: "/accion",
        rawUri: "/accion",
        sourceFile: "src/Controller/YamlController.php",
        lineNumber: 0,
        prefixChain: [],
        description: "accion",
      };
      const result = await provider.resolve(rutaYaml, match, EMPTY_SCAN_RESULT);
      expect(result.fields.map((f) => f.fieldName)).toEqual(["campo"]);
    } finally {
      await proyecto.cleanup();
    }
  });

  test("without sourceFile or with a non-existent sourceFile returns empty fields", async () => {
    const proyecto = await createTempProject({ "composer.json": COMPOSER });
    try {
      const match = await new SymfonyProjectScanner().resolve(proyecto.root);
      const sinSource: ParsedRoute = {
        method: "GET", uri: "/x", rawUri: "/x", sourceFile: "", lineNumber: 0, prefixChain: [],
      };
      expect((await provider.resolve(sinSource, match, EMPTY_SCAN_RESULT)).fields).toEqual([]);
      expect(await provider.supports(sinSource, match, EMPTY_SCAN_RESULT)).toBe(false);
      const inexistente: ParsedRoute = {
        method: "GET", uri: "/x", rawUri: "/x",
        sourceFile: "src/Controller/NoExiste.php", lineNumber: 1, prefixChain: [],
      };
      expect((await provider.resolve(inexistente, match, EMPTY_SCAN_RESULT)).fields).toEqual([]);
    } finally {
      await proyecto.cleanup();
    }
  });

  test("a block with no nearby signature does not hang and returns no fields", async () => {
    const proyecto = await createTempProject({
      "composer.json": COMPOSER,
      "src/Controller/RotoController.php": [
        "<?php",
        "class RotoController",
        "{",
        "    #[Route('/roto', methods: ['GET'])]",
        "}",
      ].join("\n"),
    });
    try {
      const { match, routes } = await scanProject("symfony", proyecto.root);
      const result = await provider.resolve(routes[0]!, match, EMPTY_SCAN_RESULT);
      expect(result.fields).toEqual([]);
    } finally {
      await proyecto.cleanup();
    }
  });
});
