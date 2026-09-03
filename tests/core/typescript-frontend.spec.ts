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

import { parse, parseModule } from "../../packages/core/language-frontends/typescript";

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

// -------------------------------------------------------------------------
// a00011 C-7 — B-rev-11 / B-rev-12 / B-rev-13
// -------------------------------------------------------------------------

describe("TypeScript frontend — orden top-down (B-rev-11)", () => {
  test("methodCalls sale ordenado por (line, column), no en orden de walker", () => {
    // `app.post` aparece en la línea 10, `app.get` en la 5. El walker
    // LIFO podría devolverlos al revés; el contrato garantiza top-down.
    const lines: string[] = [];
    lines[4] = `app.get('/get-route', (req, res) => res.json({}));`;
    lines[9] = `app.post('/post-route', (req, res) => res.json({}));`;
    const source = Array.from({ length: 10 }, (_, i) => lines[i] ?? "").join("\n");

    const file = parse(source, "server.ts");
    const routeCalls = file.methodCalls.filter((c) =>
      ["app.get", "app.post"].includes(c.callee),
    );
    expect(routeCalls).toHaveLength(2);
    expect(routeCalls[0]?.callee).toBe("app.get");
    expect(routeCalls[0]?.line).toBe(5);
    expect(routeCalls[1]?.callee).toBe("app.post");
    expect(routeCalls[1]?.line).toBe(10);
  });

  test("el orden se mantiene con las llamadas anidadas al principio del archivo", () => {
    // Llamada anidada en línea 1 y llamada simple en línea 3: el walker
    // visita la outer antes que la inner, pero ambas salen en orden
    // de línea.
    const source = [
      `app.use("/api", router.get("/users", h));`,
      ``,
      `app.post("/things", (req, res) => res.json({}));`,
    ].join("\n");
    const file = parse(source, "server.ts");
    const lines = file.methodCalls.map((c) => c.line);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
    expect(file.methodCalls[0]?.line).toBe(1);
  });

  test("assignments y symbols también quedan en orden de línea", () => {
    const source = [
      `const first = Router({ prefix: '/a' });`,
      `function middle() {}`,
      `const last = Router({ prefix: '/z' });`,
    ].join("\n");
    const file = parse(source, "server.ts");
    const assignmentLines = file.assignments.map((a) => a.line);
    const symbolLines = file.symbols.map((s) => s.line);
    expect(assignmentLines).toEqual([1, 3]);
    expect(symbolLines).toEqual([1, 2, 3]);
  });
});

describe("TypeScript frontend — bindings de imports (B-rev-12)", () => {
  test("import { Router as R } conserva el alias en bindings", () => {
    const file = parse(`import { Router as R } from "express";`, "server.ts");
    expect(file.imports).toHaveLength(1);
    expect(file.imports[0]?.bindings).toEqual([
      { local: "R", imported: "Router", isDefault: false },
    ]);
    // `names` sigue siendo el nombre importado (compat).
    expect(file.imports[0]?.names).toEqual(["Router"]);
  });

  test("import default → imported 'default' + isDefault true", () => {
    const file = parse(`import exp from "express";`, "server.ts");
    expect(file.imports[0]?.bindings).toEqual([
      { local: "exp", imported: "default", isDefault: true },
    ]);
    expect(file.imports[0]?.names).toEqual(["default"]);
  });

  test("import * as fs → imported '*' + isNamespace true", () => {
    const file = parse(`import * as fs from "fs";`, "server.ts");
    expect(file.imports[0]?.bindings).toEqual([
      { local: "fs", imported: "*", isDefault: false, isNamespace: true },
    ]);
    expect(file.imports[0]?.names).toEqual(["*"]);
  });

  test("import sin alias: local === imported", () => {
    const file = parse(`import { Router, json } from "express";`, "server.ts");
    expect(file.imports[0]?.bindings).toEqual([
      { local: "Router", imported: "Router", isDefault: false },
      { local: "json", imported: "json", isDefault: false },
    ]);
  });

  test("mixto: default + named con alias en una sola declaración", () => {
    const file = parse(
      `import exp, { Router as R } from "express";`,
      "server.ts",
    );
    expect(file.imports[0]?.bindings).toEqual([
      { local: "exp", imported: "default", isDefault: true },
      { local: "R", imported: "Router", isDefault: false },
    ]);
  });
});

describe("TypeScript frontend — parseModule con diagnostics (B-rev-13)", () => {
  test("source inválido devuelve null y registra un diagnostic de severidad error", () => {
    const diagnostics: Parameters<typeof parseModule>[2] = [];
    const file = parseModule(`const = = =`, "broken.ts", diagnostics);
    expect(file).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.file).toBe("broken.ts");
    expect(typeof diagnostics[0]?.reason).toBe("string");
    expect(diagnostics[0]?.reason.length).toBeGreaterThan(0);
  });

  test("sin array de diagnostics no lanza y sigue devolviendo null", () => {
    expect(() => parseModule(`const = = =`, "broken.ts")).not.toThrow();
    expect(parseModule(`const = = =`, "broken.ts")).toBeNull();
  });

  test("source válido parsea igual que parse y no emite diagnostics", () => {
    const diagnostics: Parameters<typeof parseModule>[2] = [];
    const file = parseModule(
      `app.get('/users', (req, res) => res.json({}));`,
      "server.ts",
      diagnostics,
    );
    expect(file).not.toBeNull();
    expect(file?.methodCalls[0]?.callee).toBe("app.get");
    expect(diagnostics).toHaveLength(0);
  });
});