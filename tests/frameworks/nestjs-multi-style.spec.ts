/**
 * x00048 S4 (a00016 S6.e) — NestJS multi-estilo E2E.
 *
 * El scanner de NestJS migró de regex línea-a-línea al AST del
 * frontend TS (`parseModule` → `decorators`). Estos tests fijan los
 * casos que la ruta regex PERDÍA y el AST recupera:
 *
 *   1. decorador de verbo partido en varias líneas
 *      (`@Get(\n  ':id'\n)`) — METHOD_DECORATOR_RE exigía el
 *      paréntesis de cierre en la misma línea;
 *   2. decoradores en el mismo orden de declaración
 *      (el AST los emite top-down, igual que el regex, pero con la
 *      línea REAL del decorador en vez de la heurística);
 *   3. `@Controller` sin argumento + verbos con path — el prefijo
 *      vacío ya no depende del orden del regex.
 *
 * Estos tests NO duplican `nestjs-scanner.spec.ts` (47 casos de
 * contrato existente: formas básicas, objeto, params, globalPrefix,
 * validación). Aquí sólo lo multi-estilo que la migración arregla.
 */
import { describe, expect, test } from "vitest";

import { createTempProject, scanProject } from "../helpers/scanner-fixture";

/** package.json mínimo que el detector de NestJS acepta. */
const NEST_PKG = JSON.stringify({
  name: "nest-multi-style",
  dependencies: { "@nestjs/core": "^10.0.0" },
});

describe("NestJS multi-estilo E2E (x00048 S4)", () => {
  test("decorador de verbo en varias líneas se detecta (el regex lo perdía)", async () => {
    const project = await createTempProject({
      "package.json": NEST_PKG,
      "src/items.controller.ts": [
        'import { Controller, Get } from "@nestjs/common";',
        "",
        "@Controller('items')",
        "export class ItemsController {",
        "  @Get(",
        "    ':id'",
        "  )",
        "  findOne() { return {}; }",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const routes = (await scanProject("nestjs", project.root)).routes;
      const found = routes.some(
        (r) => r.method === "GET" && r.uri === "/items/:id",
      );
      expect(
        found,
        `esperado GET /items/:id en:\n${routes.map((r) => `${r.method} ${r.uri}`).join("\n")}`,
      ).toBe(true);
      // lineNumber es la línea REAL del decorador (@Get en la línea 5),
      // no la heurística.
      const one = routes.find((r) => r.uri === "/items/:id");
      expect(one?.lineNumber).toBe(5);
    } finally {
      await project.cleanup();
    }
  });

  test("@Controller multi-línea con forma objeto partido", async () => {
    const project = await createTempProject({
      "package.json": NEST_PKG,
      "src/multi.controller.ts": [
        'import { Controller, Post } from "@nestjs/common";',
        "",
        "@Controller({",
        "  path: 'orders',",
        "  version: '1',",
        "})",
        "export class OrdersController {",
        "  @Post()",
        "  create() { return {}; }",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const routes = (await scanProject("nestjs", project.root)).routes;
      const found = routes.some(
        (r) => r.method === "POST" && r.uri === "/orders",
      );
      expect(
        found,
        `esperado POST /orders en:\n${routes.map((r) => `${r.method} ${r.uri}`).join("\n")}`,
      ).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("varios verbos en un controller mantienen el orden top-down", async () => {
    const project = await createTempProject({
      "package.json": NEST_PKG,
      "src/crud.controller.ts": [
        'import { Controller, Get, Post, Put, Delete } from "@nestjs/common";',
        "",
        "@Controller('crud')",
        "export class CrudController {",
        "  @Get() list() { return []; }",
        "  @Post() create() { return {}; }",
        "  @Put(':id') update() { return {}; }",
        "  @Delete(':id') remove() { return {}; }",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const result = await scanProject("nestjs", project.root);
      const pairs = result.routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toEqual([
        "GET /crud",
        "POST /crud",
        "PUT /crud/:id",
        "DELETE /crud/:id",
      ]);
    } finally {
      await project.cleanup();
    }
  });

  test("decorador comentado NO produce ruta (el AST ve el comentario como comentario)", async () => {
    const project = await createTempProject({
      "package.json": NEST_PKG,
      "src/commented.controller.ts": [
        'import { Controller, Get } from "@nestjs/common";',
        "",
        "@Controller('real')",
        "export class RealController {",
        "  // @Get('fantasma')",
        "  @Get('existe')",
        "  one() { return {}; }",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const routes = (await scanProject("nestjs", project.root)).routes;
      const uris = routes.map((r) => r.uri);
      expect(uris).toContain("/real/existe");
      expect(uris).not.toContain("/real/fantasma");
    } finally {
      await project.cleanup();
    }
  });

  test("archivo no-parseable degrada al fallback sin romper el scan", async () => {
    // Un fichero con sintaxis que Babel no digiere incluso con
    // errorRecovery: el scanner NO debe abortar; devuelve lo que
    // pueda (posiblemente nada) y el resto del proyecto sigue.
    const project = await createTempProject({
      "package.json": NEST_PKG,
      "src/good.controller.ts": [
        'import { Controller, Get } from "@nestjs/common";',
        "",
        "@Controller('good')",
        "export class GoodController {",
        "  @Get() one() { return {}; }",
        "}",
        "",
      ].join("\n"),
      "src/broken.controller.ts": "@Controller('broken' export class { @Get() x() }",
    });
    try {
      const routes = (await scanProject("nestjs", project.root)).routes;
      const found = routes.some(
        (r) => r.method === "GET" && r.uri === "/good",
      );
      expect(found, "el controller bueno sobrevive al vecino roto").toBe(true);
    } finally {
      await project.cleanup();
    }
  });
});