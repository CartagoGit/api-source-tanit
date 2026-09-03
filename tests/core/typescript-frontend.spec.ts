/**
 * Tests del frontend TypeScript (a00010 S7).
 *
 * Cubre las cinco primitivas que los scanners consumen:
 *   - `imports` → detección de módulos importados.
 *   - `symbols` → declaraciones top-level (función/clase/variable).
 *   - `methodCalls` → `app.get('/x', h)` (la base de Express, Hono,
 *     Fastify, tRPC, Next.js).
 *   - `decorators` → `@Controller('/api')` (la base de NestJS).
 *   - `assignments` → `const router = Router(...)` (la base del
 *     prefix detection).
 *
 * Cada test es un snippet pequeño y aislado — el parser tiene que
 * funcionar igual sobre multilínea, sobre arrow functions con body,
 * sobre strings con caracteres Unicode, etc.
 *
 * (a00010 S7 — slice AST TypeScript)
 */

import { describe, expect, test } from "vitest";

import { parse } from "../../packages/core/language-frontends/typescript";

describe("TypeScript frontend — imports", () => {
  test("import default detecta source y `default` como name", () => {
    const file = parse(`import express from "express";`, "server.ts");
    expect(file.imports).toHaveLength(1);
    expect(file.imports[0]?.source).toBe("express");
    expect(file.imports[0]?.names).toEqual(["default"]);
  });

  test("import named con destructuring lista los nombres", () => {
    const file = parse(
      `import { Router, static as expressStatic } from "express";`,
      "server.ts",
    );
    expect(file.imports).toHaveLength(1);
    expect(file.imports[0]?.source).toBe("express");
    expect(file.imports[0]?.names).toEqual(["Router", "static"]);
  });

  test("múltiples imports se acumulan en orden", () => {
    const file = parse(
      [
        `import express from "express";`,
        `import { z } from "zod";`,
        `import "reflect-metadata";`,
      ].join("\n"),
      "server.ts",
    );
    expect(file.imports).toHaveLength(3);
    expect(file.imports.map((i) => i.source)).toEqual([
      "express",
      "zod",
      "reflect-metadata",
    ]);
  });
});

describe("TypeScript frontend — symbols", () => {
  test("function declaration se reconoce como símbolo", () => {
    const file = parse(`function boot() {}`, "server.ts");
    expect(file.symbols).toHaveLength(1);
    expect(file.symbols[0]).toMatchObject({
      name: "boot",
      kind: "function",
    });
  });

  test("variable declaration se reconoce como símbolo", () => {
    const file = parse(`const app = express();`, "server.ts");
    const sym = file.symbols.find((s) => s.name === "app");
    expect(sym).toBeDefined();
    expect(sym?.kind).toBe("variable");
  });

  test("class declaration se reconoce como símbolo Y se duplica en `classes`", () => {
    const file = parse(`class UsersController {}`, "server.ts");
    expect(file.symbols.some((s) => s.name === "UsersController" && s.kind === "class")).toBe(true);
    expect(file.classes.some((c) => c.name === "UsersController")).toBe(true);
  });
});

describe("TypeScript frontend — methodCalls", () => {
  test("app.get con path string y handler arrow", () => {
    const file = parse(
      `app.get('/users', (req, res) => res.json([]));`,
      "server.ts",
    );
    // methodCalls contiene la outer call y la inner `res.json(...)`;
    // el adapter filtra por `callee.startsWith('app.')` o por shape,
    // pero aquí comprobamos la outer por su callee.
    const call = file.methodCalls.find((c) => c.callee === "app.get");
    expect(call).toBeDefined();
    expect(call?.line).toBe(1);
    expect(call?.args[0]).toMatchObject({ kind: "string", value: "/users" });
    expect(call?.args[1]?.kind).toBe("arrow");
    expect(call?.bodyRange).toBeDefined();
  });

  test("router.post multilínea con tres argumentos", () => {
    const file = parse(
      [
        `router.post(`,
        `  "/users",`,
        `  auth,`,
        `  (req, res) => {`,
        `    res.json({});`,
        `  }`,
        `);`,
      ].join("\n"),
      "server.ts",
    );
    const call = file.methodCalls.find((c) => c.callee === "router.post");
    expect(call).toBeDefined();
    expect(call?.args[0]).toMatchObject({ kind: "string", value: "/users" });
    expect(call?.args[1]?.kind).toBe("identifier");
    expect(call?.args[2]?.kind).toBe("arrow");
    expect(call?.bodyRange).toBeDefined();
  });

  test("app.METHOD sin string literal como primer argumento se queda como method call", () => {
    // No es una ruta declarable, pero el parser aún la captura.
    // Los adapters son los que la descartan si el primer argumento
    // no es un string literal.
    const file = parse(`app.get(path, h);`, "server.ts");
    const call = file.methodCalls[0];
    expect(call?.callee).toBe("app.get");
    expect(call?.args[0]?.kind).toBe("identifier");
  });

  test("métodos HTTP que no son declaración de ruta también salen", () => {
    // `app.use(...)` no es una ruta pero es una llamada a método;
    // el parser no filtra por nombre — eso es trabajo del adapter.
    const file = parse(`app.use("/api", router);`, "server.ts");
    const call = file.methodCalls[0];
    expect(call?.callee).toBe("app.use");
  });

  test("anidamiento: un call dentro de otro se cuenta una vez por nivel", () => {
    // `app.use(prefix, router.get('/users', h))` produce 2 methodCalls:
    // una para `app.use(...)` y otra para `router.get(...)` (porque el
    // walker visita TODOS los nodos).
    const file = parse(`app.use("/api", router.get("/users", h));`, "server.ts");
    const cales = file.methodCalls.map((c) => c.callee).sort();
    expect(cales).toEqual(["app.use", "router.get"]);
  });
});

describe("TypeScript frontend — decorators (NestJS)", () => {
  test("@Controller con argumento string", () => {
    const file = parse(
      [
        `@Controller('/users')`,
        `class UsersController {`,
        `  @Get()`,
        `  list() {}`,
        `}`,
      ].join("\n"),
      "controller.ts",
    );
    expect(file.classes).toHaveLength(1);
    const cls = file.classes[0];
    expect(cls?.decorators).toHaveLength(1);
    expect(cls?.decorators[0]?.name).toBe("Controller");
    expect(cls?.decorators[0]?.args[0]).toMatchObject({ kind: "string", value: "/users" });
    expect(cls?.decorators[0]?.target).toBe("UsersController");

    const listMethod = cls?.methods.find((m) => m.name === "list");
    expect(listMethod?.decorators).toHaveLength(1);
    expect(listMethod?.decorators[0]?.name).toBe("Get");
    expect(listMethod?.decorators[0]?.target).toBe("list");
  });

  test("@Get con argumento string en el método", () => {
    const file = parse(
      [
        `@Controller('/users')`,
        `class UsersController {`,
        `  @Get(':id')`,
        `  getOne() {}`,
        `}`,
      ].join("\n"),
      "controller.ts",
    );
    const cls = file.classes[0];
    const get = cls?.methods.find((m) => m.name === "getOne");
    expect(get?.decorators[0]?.args[0]).toMatchObject({ kind: "string", value: ":id" });
  });

  test("decorator sin argumentos (e.g. @Get())", () => {
    const file = parse(
      [`class X {`, `  @Get()`, `  list() {}`, `}`].join("\n"),
      "x.ts",
    );
    const list = file.classes[0]?.methods.find((m) => m.name === "list");
    expect(list?.decorators[0]?.args).toEqual([]);
  });
});

describe("TypeScript frontend — assignments", () => {
  test("const app = express() produce un assignment con kind call (unknown)", () => {
    const file = parse(`const app = express();`, "server.ts");
    const a = file.assignments.find((x) => x.name === "app");
    expect(a).toBeDefined();
    // `express()` es una CallExpression — el parser no la abre,
    // solo la marca como unknown.
    expect(a?.value.kind).toBe("unknown");
  });

  test("const router = Router({ prefix: '/api/v1' }) incluye el objeto literal", () => {
    const file = parse(
      `const router = Router({ prefix: '/api/v1' });`,
      "server.ts",
    );
    const a = file.assignments.find((x) => x.name === "router");
    expect(a).toBeDefined();
    expect(a?.value.kind).toBe("object");
    const prefix = a?.value.objectShape?.find((p) => p.key === "prefix");
    expect(prefix?.literal).toMatchObject({ kind: "string", value: "/api/v1" });
  });

  test("asignación tras `=` (no declaración) también se captura", () => {
    const file = parse(`app = express();`, "server.ts");
    const a = file.assignments.find((x) => x.name === "app");
    expect(a).toBeDefined();
    expect(a?.value.kind).toBe("unknown");
  });
});

describe("TypeScript frontend — integración Express", () => {
  test("Snippet completo: imports + declarations + route + multilínea", () => {
    const source = [
      `import express from "express";`,
      `const app = express();`,
      ``,
      `app.get('/health', (req, res) => res.json({ ok: true }));`,
      ``,
      `app.post(`,
      `  '/users',`,
      `  (req, res) => {`,
      `    res.json({ id: 1 });`,
      `  }`,
      `);`,
    ].join("\n");

    const file = parse(source, "server.ts");
    expect(file.imports).toHaveLength(1);
    expect(file.imports[0]?.source).toBe("express");
    expect(file.assignments.some((a) => a.name === "app")).toBe(true);
    const getCall = file.methodCalls.find((c) => c.callee === "app.get");
    const postCall = file.methodCalls.find((c) => c.callee === "app.post");
    expect(getCall?.args[0]).toMatchObject({ kind: "string", value: "/health" });
    expect(postCall?.args[0]).toMatchObject({ kind: "string", value: "/users" });
    expect(postCall?.bodyRange).toBeDefined();
  });
});