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
    expect((await new SymfonyProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 en directorio sin composer.json", async () => {
    expect((await new SymfonyProjectScanner().detect("/tmp")).score).toBe(0);
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

// ---------------------------------------------------------------------------
// Detection: variantes de composer.json / marcadores.
// ---------------------------------------------------------------------------

describe("Symfony detect — variantes", () => {
  test("require-dev también cuenta como Symfony", async () => {
    const project = await createTempProject({
      "composer.json": '{"require-dev":{"symfony/routing":"^7.0"}}',
      "config/routes.yaml": "vivo:\n  path: /vivo\n  controller: C::v\n  methods: [GET]\n",
    });
    try {
      // Ni bin/console ni src/Controller pero sí routes.yaml → 0.8.
      expect((await new SymfonyProjectScanner().detect(project.root)).score).toBe(0.8);
    } finally {
      await project.cleanup();
    }
  });

  test("solo composer.json con Symfony da 0.4", async () => {
    const project = await createTempProject({
      "composer.json": '{"require":{"symfony/framework-bundle":"^7.0"}}',
    });
    try {
      expect((await new SymfonyProjectScanner().detect(project.root)).score).toBe(0.4);
    } finally {
      await project.cleanup();
    }
  });

  test("composer.json corrupto da 0", async () => {
    const project = await createTempProject({
      "composer.json": "{json roto",
    });
    try {
      expect((await new SymfonyProjectScanner().detect(project.root)).score).toBe(0);
    } finally {
      await project.cleanup();
    }
  });

  test("sin sección require en composer.json no lanza y da 0", async () => {
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

describe("Symfony — rutas YAML", () => {
  test("prefix se concatena y controller::action queda en actionName", async () => {
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
      // methods como string: se parte por | o , sin contaminar description.
      const str = routes.find((r) => r.uri === "/s");
      expect(str?.method).toBe("GET");
      expect(str?.description).toBeUndefined();
      expect(str?.actionName).toBe("s");
      // Ni controller ni entrada escalar producen nada.
      expect(routes).toHaveLength(2);
    } finally {
      await project.cleanup();
    }
  });

  test("methods string con varios verbos separados por |", async () => {
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

  test("verbos no HTTP en un methods string se descartan", async () => {
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

  test("resource: que apunta a un controller se parsea con prefix", async () => {
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
      // El prefix viene del YAML más el #[Route] de clase.
      expect(routes[0]?.prefixChain).toEqual(["/api/widgets"]);
      // sourceFile relativo: el bug histórico de Symfony.
      expect(routes[0]?.sourceFile).toBe("src/Controller/WidgetController.php");
    } finally {
      await project.cleanup();
    }
  });

  test("resource en config/routes se resuelve relativo al YAML", async () => {
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

  test("resource que no es string y resource sin Controller.php no producen nada", async () => {
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

  test("config/routes/: solo .yaml/.yml, lo demás se ignora", async () => {
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

  test("YAML sin mapping raíz no produce rutas ni lanza", async () => {
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
// Atributos #[Route]: variantes del método y dedupe con YAML.
// ---------------------------------------------------------------------------

describe("Symfony — atributos #[Route]", () => {
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

  test("name, methods de un solo string y verbs por defecto", async () => {
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
    // Sin methods declarados: Symfony contesta a GET.
    const sinMetodo = routes.find((r) => r.method === "GET" && r.uri === "/base/sin-metodo");
    expect(sinMetodo).toBeDefined();
  });

  test("verbo desconocido se descarta y la firma a +3 líneas sigue dando nombre", async () => {
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
    // Sin firma en las 3 líneas siguientes: displayName derivado.
    const sinFirma = routes.find((r) => r.uri === "/base/sin-firma");
    expect(sinFirma?.displayName).toBe("GET /base/sin-firma");
    expect(sinFirma?.description).toBeUndefined();
  });

  test("dedupe: YAML + #[Route] dejan la del atributo (más informativa)", async () => {
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

  test("dedupe en la raíz ('/') no colapsa barras de más", async () => {
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

describe("Symfony — provider de assertions", () => {
  test("YAML controller::action resuelve assertions del método", async () => {
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
      const result = await provider.resolve(route, match);
      expect(result.fields.map((field) => field.fieldName)).toContain("reference");
    } finally {
      await project.cleanup();
    }
  });
  const provider = new SymfonyAttributesValidationProvider();

  test("todos los tipos de Assert: formato, cotas, enum y allowNull", async () => {
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
      const result = await provider.resolve(post!, match);
      const byName = new Map(result.fields.map((f) => [f.fieldName, f]));
      expect(byName.get("name")).toMatchObject({ type: "string", required: true });
      expect(byName.get("email")).toMatchObject({ type: "string", format: "email" });
      expect(byName.get("title")).toMatchObject({ minLength: 2, maxLength: 60 });
      expect(byName.get("role")).toMatchObject({ type: "enum", enumValues: ["a", "b"] });
      expect(byName.get("age")).toMatchObject({ type: "integer", minimum: 0, maximum: 100 });
      expect(byName.get("opt")).toMatchObject({ required: false });
      // Un Assert desconocido no produce campo.
      expect(byName.has("raro")).toBe(false);
    } finally {
      await proyecto.cleanup();
    }
  });

  test("Assert en línea separada del parámetro (búsqueda a 3 líneas)", async () => {
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
      const result = await provider.resolve(routes.find((r) => r.method === "POST")!, match);
      expect(result.fields.map((f) => f.fieldName)).toEqual(["nombre"]);
    } finally {
      await proyecto.cleanup();
    }
  });

  test("ruta YAML sin #[Route]: localiza el método por description", async () => {
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
      const result = await provider.resolve(rutaYaml, match);
      expect(result.fields.map((f) => f.fieldName)).toEqual(["campo"]);
    } finally {
      await proyecto.cleanup();
    }
  });

  test("sin sourceFile o con sourceFile inexistente devuelve fields vacías", async () => {
    const proyecto = await createTempProject({ "composer.json": COMPOSER });
    try {
      const match = await new SymfonyProjectScanner().resolve(proyecto.root);
      const sinSource: ParsedRoute = {
        method: "GET", uri: "/x", rawUri: "/x", sourceFile: "", lineNumber: 0, prefixChain: [],
      };
      expect((await provider.resolve(sinSource, match)).fields).toEqual([]);
      expect(await provider.supports(sinSource, match)).toBe(false);
      const inexistente: ParsedRoute = {
        method: "GET", uri: "/x", rawUri: "/x",
        sourceFile: "src/Controller/NoExiste.php", lineNumber: 1, prefixChain: [],
      };
      expect((await provider.resolve(inexistente, match)).fields).toEqual([]);
    } finally {
      await proyecto.cleanup();
    }
  });

  test("bloque sin signature cercana no cuelga y devuelve sin campos", async () => {
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
      const result = await provider.resolve(routes[0]!, match);
      expect(result.fields).toEqual([]);
    } finally {
      await proyecto.cleanup();
    }
  });
});
