import { describe, expect, test } from "vitest";
import {
  SpringBootProjectScanner,
  SpringBootRouteScanner,
  SpringBootBeanValidationProvider,
} from "../../projects/frameworks/scanners/springboot.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

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
  test("detect() > 0 cuando pom.xml tiene spring-boot-starter-web", async () => {
    expect(await new SpringBootProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay pom.xml ni build.gradle", async () => {
    expect(await new SpringBootProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 4 rutas del mini-fixture", async () => {
    const match = await new SpringBootProjectScanner().resolve(ROOT);
    const routes = await new SpringBootRouteScanner().scan(match);
    expect(routes).toHaveLength(4);
  });

  test("@RequestMapping('/api/users') aplicado como prefijo de clase", async () => {
    const match = await new SpringBootProjectScanner().resolve(ROOT);
    const routes = await new SpringBootRouteScanner().scan(match);
    for (const r of routes) expect(r.uri).toMatch(/^\/api\/users/);
  });

  test("GET, POST, GET/{id}, DELETE/{id} todos presentes", async () => {
    const match = await new SpringBootProjectScanner().resolve(ROOT);
    const routes = await new SpringBootRouteScanner().scan(match);
    const methods = routes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "GET", "POST"]);
  });

  test("path param {id} de @GetMapping('/{id}') en la uri", async () => {
    const match = await new SpringBootProjectScanner().resolve(ROOT);
    const routes = await new SpringBootRouteScanner().scan(match);
    const show = routes.find((r) => r.method === "GET" && r.uri.includes("{id}"));
    expect(show).toBeDefined();
  });

  test("comprehensive: detecta >10 rutas en multi-controller Java", async () => {
    const match = await new SpringBootProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new SpringBootRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  test("@RequestBody provider resuelve campos del DTO para POST", async () => {
    const match = await new SpringBootProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new SpringBootRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("users"));
    if (!post) return;
    const provider = new SpringBootBeanValidationProvider();
    const result = await provider.resolve(post, match);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
  });
});
