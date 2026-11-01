import { describe, expect, test } from "vitest";
import {
  SpringBootProjectScanner,
  SpringBootRouteScanner,
  SpringBootBeanValidationProvider,
} from "../../packages/frameworks/scanners/springboot.scanner";
import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";
describeScannerContract({
  framework: "springboot",
  fixtureRoot: comprehensiveFixture("springboot"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "pom.xml": '<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>',
    "src/main/java/com/example/VivoController.java": 'package com.example;\n\nimport org.springframework.web.bind.annotation.*;\n\n@RestController\n@RequestMapping("/vivo")\npublic class VivoController {\n    @GetMapping\n    public String list() { return ""; }\n}\n',
  },
  commentedEndpoint: {
    file: 'src/main/java/com/example/VivoController.java',
    source: '    // @GetMapping("/endpoint-comentado")',
  },
});

const ROOT = smokeFixtureDir("springboot");
const COMPREHENSIVE = comprehensiveFixtureDir("springboot");

describe("Spring Boot scanner", () => {
  test("detect() > 0 when pom.xml contains spring-boot-starter-web", async () => {
    expect((await new SpringBootProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 when there is no pom.xml or build.gradle", async () => {
    expect((await new SpringBootProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() finds the 4 routes of the mini-fixture", async () => {
    const match = await new SpringBootProjectScanner().resolve(ROOT);
    const routes = (await new SpringBootRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(4);
  });

  test("@RequestMapping('/api/users') applied as class-level prefix", async () => {
    const match = await new SpringBootProjectScanner().resolve(ROOT);
    const routes = (await new SpringBootRouteScanner().scan(match)).routes;
    for (const r of routes) expect(r.uri).toMatch(/^\/api\/users/);
  });

  test("GET, POST, GET/{id}, DELETE/{id} all present", async () => {
    const match = await new SpringBootProjectScanner().resolve(ROOT);
    const routes = (await new SpringBootRouteScanner().scan(match)).routes;
    const methods = routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "GET", "POST"]);
  });

  test("path param {id} from @GetMapping('/{id}') in the uri", async () => {
    const match = await new SpringBootProjectScanner().resolve(ROOT);
    const routes = (await new SpringBootRouteScanner().scan(match)).routes;
    const show = routes.find((r) => r.method === "GET" && r.uri.includes("{id}"));
    expect(show).toBeDefined();
  });

  test("comprehensive: detects >10 routes in multi-controller Java", async () => {
    const match = await new SpringBootProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new SpringBootRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  test("@RequestBody provider resolves DTO fields for POST", async () => {
    const match = await new SpringBootProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new SpringBootRouteScanner().scan(match)).routes;
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("users"));
    if (!post) return;
    const provider = new SpringBootBeanValidationProvider();
    const result = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
  });

  // a00010 / B-05: the canonical Kotlin fixture lives in
  // `src/main/kotlin/`. Before the fix, the scanner only entered via
  // `src/main/java/` and a standard Kotlin project ended up empty.
  test("scan() reads `src/main/kotlin/` (B-05 a00010)", async () => {
    const kotlinRoot = smokeFixtureDir("springboot-kotlin");
    const match = await new SpringBootProjectScanner().resolve(kotlinRoot);
    const routes = (await new SpringBootRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(4);
    const uris = routes.map((r) => `${r.method} ${r.uri}`).sort();
    expect(uris).toEqual([
      "DELETE /api/users/{id}",
      "GET /api/users",
      "GET /api/users/{id}",
      "POST /api/users",
    ]);
  });

  test("detect() exposes the Kotlin artifact", async () => {
    const kotlinRoot = smokeFixtureDir("springboot-kotlin");
    const match = await new SpringBootProjectScanner().resolve(kotlinRoot);
    expect(match.artifacts).toContain("src/main/kotlin");
  });

  // a00011 C-6: the multi-line annotation is vanilla Java. Before
  // the fix, `\([^)]*\)` required the close paren on the same line,
  // so a whole `@GetMapping(path = "/users", produces = ...)` was
  // lost.
  test("multi-line annotation with path = ... is parsed (C-6 a00011)", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "pom.xml": `<?xml version="1.0"?>
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>`,
      "src/main/java/com/ej/App.java": `package com.ej;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api")
public class App {
  @GetMapping(
      path = "/users",
      produces = "application/json"
  )
  public java.util.List<String> list() { return java.util.List.of(); }

  @PostMapping(
      value = "/users",
      consumes = "application/json"
  )
  public String create(@RequestBody String body) { return body; }
}
`,
    });
    const match = await new SpringBootProjectScanner().resolve(project.root);
    const routes = (await new SpringBootRouteScanner().scan(match)).routes;
    const uris = routes.map((r) => `${r.method.toUpperCase()} ${r.uri}`).sort();
    expect(uris).toEqual(["GET /api/users", "POST /api/users"]);
    await project.cleanup();
  });
});

describe("Spring Boot — build.gradle detection and variants", () => {
  test("detect() > 0 with a build.gradle containing spring-boot", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "build.gradle": "plugins {\n    id 'org.springframework.boot' version '3.2.0'\n}\ndependencies {\n    implementation 'org.springframework.boot:spring-boot-starter-web:3.2.0'\n}\n",
      "src/main/java/com/example/App.java": "package com.example;\npublic class App {}",
    });
    try {
      expect((await new SpringBootProjectScanner().detect(project.root)).score).toBeGreaterThan(0);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 0.7 with a spring-boot pom.xml but no src/ dir", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "pom.xml": "<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>",
    });
    try {
      expect((await new SpringBootProjectScanner().detect(project.root)).score).toBe(0.7);
    } finally {
      await project.cleanup();
    }
  });

  test("resolve() with build.gradle includes build.gradle in artifacts", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "build.gradle": "id 'org.springframework.boot'",
      "src/main/java/com/example/App.java": "package com.example;\npublic class App {}",
    });
    try {
      const match = await new SpringBootProjectScanner().resolve(project.root);
      expect(match.artifacts).toContain("build.gradle");
    } finally {
      await project.cleanup();
    }
  });

  test("build.gradle.kts with spring-boot is also detected", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "build.gradle.kts": 'id("org.springframework.boot") version "3.2.0"\nimplementation("org.springframework.boot:spring-boot-starter-web:3.2.0")\n',
    });
    try {
      expect((await new SpringBootProjectScanner().detect(project.root)).score).toBeGreaterThan(0);
    } finally {
      await project.cleanup();
    }
  });
});

describe("Spring Boot — @RestController without @RequestMapping (no classPrefix)", () => {
  test("@RestController without @RequestMapping generates routes from root /", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "pom.xml": "<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>",
      "src/main/java/com/example/HealthController.java": [
        "package com.example;",
        "import org.springframework.web.bind.annotation.*;",
        "@RestController",
        "public class HealthController {",
        "    @GetMapping(\"/health\")",
        "    public String health() { return \"ok\"; }",
        "    @PostMapping(\"/echo\")",
        "    public String echo() { return \"echo\"; }",
        "}",
      ].join("\n"),
    });
    try {
      const match = await new SpringBootProjectScanner().resolve(project.root);
      const routes = (await new SpringBootRouteScanner().scan(match)).routes;
      const uris = routes.map((r) => r.uri);
      expect(uris).toContain("/health");
      expect(uris).toContain("/echo");
    } finally {
      await project.cleanup();
    }
  });
});

describe("Spring Boot — @RequestMapping with method = RequestMethod.X", () => {
  test("@RequestMapping with method = RequestMethod.POST generates a POST route", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "pom.xml": "<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>",
      "src/main/java/com/example/OrderController.java": [
        "package com.example;",
        "import org.springframework.web.bind.annotation.*;",
        "@RestController",
        "@RequestMapping(\"/api/orders\")",
        "public class OrderController {",
        "    @RequestMapping(value = \"/submit\", method = RequestMethod.POST)",
        "    public String submit() { return \"ok\"; }",
        "    @RequestMapping(value = \"/list\", methods = { RequestMethod.GET })",
        "    public String list() { return \"ok\"; }",
        "}",
      ].join("\n"),
    });
    try {
      const match = await new SpringBootProjectScanner().resolve(project.root);
      const routes = (await new SpringBootRouteScanner().scan(match)).routes;
      const pairs = routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toContain("POST /api/orders/submit");
      expect(pairs).toContain("GET /api/orders/list");
    } finally {
      await project.cleanup();
    }
  });
});

describe("Spring Boot — Kotlin (.kt) controllers", () => {
  test("Kotlin controller with @GetMapping generates routes", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "pom.xml": "<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>",
      "src/main/java/com/example/ProductController.kt": [
        "package com.example",
        "import org.springframework.web.bind.annotation.*",
        "@RestController",
        "@RequestMapping(\"/api/products\")",
        "class ProductController {",
        "    @GetMapping",
        "    fun list(): List<String> = listOf()",
        "    @PostMapping",
        "    fun create(): String = \"ok\"",
        "}",
      ].join("\n"),
    });
    try {
      const match = await new SpringBootProjectScanner().resolve(project.root);
      const routes = (await new SpringBootRouteScanner().scan(match)).routes;
      const uris = routes.map((r) => r.uri);
      expect(uris.some((u) => u.startsWith("/api/products"))).toBe(true);
    } finally {
      await project.cleanup();
    }
  });
});

describe("Spring Boot — BeanValidationProvider branches", () => {
  test("supports() === false when sourceFile is undefined", async () => {
    const route = { method: "GET", uri: "/items", rawUri: "/items", sourceFile: (undefined as string | undefined) as string, lineNumber: 1, prefixChain: [] };
    const match = { framework: "springboot" as const, projectRoot: "/tmp", artifacts: [] };
    const provider = new SpringBootBeanValidationProvider();
    expect(await provider.supports(route, match, EMPTY_SCAN_RESULT)).toBe(false);
  });

  test("supports() === false when the framework is not springboot", async () => {
    const route = { method: "GET", uri: "/items", rawUri: "/items", sourceFile: "ItemsController.java", lineNumber: 1, prefixChain: [] };
    const match = { framework: "nestjs" as const, projectRoot: "/tmp", artifacts: [] };
    const provider = new SpringBootBeanValidationProvider();
    expect(await provider.supports(route, match, EMPTY_SCAN_RESULT)).toBe(false);
  });

  test("resolve() returns empty when there is no @RequestBody in the file", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "pom.xml": "<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>",
      "src/main/java/com/example/NobodyController.java": [
        "package com.example;",
        "import org.springframework.web.bind.annotation.*;",
        "@RestController",
        "@RequestMapping(\"/api/nobody\")",
        "public class NobodyController {",
        "    @GetMapping",
        "    public String list() { return \"ok\"; }",
        "}",
      ].join("\n"),
    });
    try {
      const match = await new SpringBootProjectScanner().resolve(project.root);
      const routes = (await new SpringBootRouteScanner().scan(match)).routes;
      const get = routes.find((r) => r.method === "GET");
      if (!get) return;
      const provider = new SpringBootBeanValidationProvider();
      const result = await provider.resolve(get, match, EMPTY_SCAN_RESULT);
      expect(result.fields).toHaveLength(0);
    } finally {
      await project.cleanup();
    }
  });

  test("resolve() uses findDtoInProject when the DTO is in a separate file", async () => {
    const { createTempProject } = await import("../helpers/scanner-fixture");
    const project = await createTempProject({
      "pom.xml": "<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>",
      "src/main/java/com/example/ItemController.java": [
        "package com.example;",
        "import org.springframework.web.bind.annotation.*;",
        "import jakarta.validation.Valid;",
        "@RestController",
        "@RequestMapping(\"/api/items\")",
        "public class ItemController {",
        "    @PostMapping",
        "    public Item create(@RequestBody @Valid Item body) { return body; }",
        "}",
      ].join("\n"),
      "src/main/java/com/example/Item.java": [
        "package com.example;",
        "import jakarta.validation.constraints.*;",
        "public class Item {",
        "    @NotBlank",
        "    private String name;",
        "    @NotNull",
        "    private Integer price;",
        "}",
      ].join("\n"),
    });
    try {
      const match = await new SpringBootProjectScanner().resolve(project.root);
      const routes = (await new SpringBootRouteScanner().scan(match)).routes;
      const post = routes.find((r) => r.method === "POST");
      if (!post) return;
      const provider = new SpringBootBeanValidationProvider();
      const result = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
      expect(result.fields.map((f) => f.fieldName)).toContain("name");
    } finally {
      await project.cleanup();
    }
  });
});
