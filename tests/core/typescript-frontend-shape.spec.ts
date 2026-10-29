/**
 * The TypeScript frontend, seen through the agnostic contract.
 *
 * Three things are checked:
 *
 * 1. **The frontend implements the contract.** Every method of
 *    `ILanguageFrontend` answers, and what it answers has the shape
 *    the contract declares — at runtime, not only at compile time,
 *    because an interface disappears at runtime and a frontend that
 *    forgets to fill a field would typecheck fine.
 *
 * 2. **The multi-style callees survive the projection.** The
 *    LanguageIR recognises six shapes of callee; the agnostic
 *    `ICallExpression` has to carry all six *structured*, so that a
 *    consumer never has to split a string to find out the verb.
 *
 * 3. **The refactor is invisible.** The TypeScript frontend that the
 *    scanners already consume keeps returning exactly what it
 *    returned, and the route extraction keeps working. A new view of
 *    the same parse, added next to the old one — not a replacement.
 *
 * The last describe checks the other half of the slice's promise:
 * that no consumer of the IR reaches into a concrete implementation.
 *
 * (r00020 S2 — LanguageIR agnostic foundation)
 */
import { describe, expect, test } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { repoRoot } from "../../packages/core/helpers/module-path.helper.js";
import {
  extractRoutes,
  parse,
  typescriptFrontend,
} from "../../packages/core/language-frontends/typescript/index.js";
import type { ILanguageFrontend } from "../../packages/contracts/interfaces/language-ir/language-ir.interface.js";

const RAIZ = repoRoot(import.meta.url);

/** The four methods the contract asks a frontend for. */
const METODOS = [
  "parse",
  "extractSymbols",
  "extractCalls",
  "extractDecorators",
] as const;

/**
 * The folders the scanners live in. The proposal named
 * `packages/core/scanners/`, which does not exist in this repository:
 * the scanners are in `packages/frameworks/scanners/`. The folder is
 * listed twice on purpose — if a `core/scanners/` ever appears, it is
 * watched from the day it appears.
 */
const CARPETAS = [
  join(RAIZ, "packages", "core", "scanners"),
  join(RAIZ, "packages", "frameworks", "scanners"),
];

/** The vocabulary that would tie a scanner to one concrete parser. */
const PROHIBIDO = /@ts-ignore|ts\.Node|babel/i;

/** Every `.ts` file under a folder, recursively. */
async function ficherosDe(carpeta: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(carpeta, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(carpeta, entry.name);
    if (entry.isDirectory()) out.push(...(await ficherosDe(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("el frontend TypeScript implementa ILanguageFrontend", () => {
  test("declara los cuatro métodos del contrato", () => {
    expect(typescriptFrontend.languageId).toBe("typescript");
    for (const metodo of METODOS) {
      expect(typeof typescriptFrontend[metodo]).toBe("function");
    }
  });

  test("es asignable a ILanguageFrontend", () => {
    // La comprobación de tipos es la que manda aquí; la de runtime es
    // la de arriba. Esta línea no hace nada por sí sola — pero si el
    // frontend dejara de cumplir el contrato, el typecheck falla.
    const frontend: ILanguageFrontend = typescriptFrontend;
    expect(frontend.languageId).toBe("typescript");
  });

  test("parse devuelve un documento con las tres colecciones", () => {
    const document = typescriptFrontend.parse(
      ["const app = 1;", 'app.get("/x", handler);'].join("\n"),
      "src/server.ts",
    );
    expect(document.languageId).toBe("typescript");
    expect(document.filename).toBe("src/server.ts");
    expect(document.symbols.length).toBeGreaterThan(0);
    expect(document.calls.length).toBeGreaterThan(0);
    expect(document.decorators).toEqual([]);
  });

  test("los extractores devuelven la colección del documento", () => {
    const document = typescriptFrontend.parse(
      ["@Controller('/x')", "class A { @Get() m() {} }"].join("\n"),
      "src/a.ts",
    );
    expect(typescriptFrontend.extractSymbols(document)).toEqual(
      document.symbols,
    );
    expect(typescriptFrontend.extractCalls(document)).toEqual(document.calls);
    expect(typescriptFrontend.extractDecorators(document)).toEqual(
      document.decorators,
    );
  });
});

describe("los símbolos y los decoradores se proyectan sin perder información", () => {
  const FUENTE = [
    "@Controller('/users')",
    "export class UsersController {",
    "  @Get(':id')",
    "  getUser() { return {}; }",
    "}",
    "",
    "export function helper() { return 1; }",
  ].join("\n");

  test("la clase y su método aparecen, con el método colgando de la clase", () => {
    const document = typescriptFrontend.parse(FUENTE, "src/users.controller.ts");
    const clase = document.symbols.find((s) => s.name === "UsersController");
    expect(clase?.kind).toBe("class");
    expect(clase?.exported).toBe(true);

    const metodo = document.symbols.find((s) => s.name === "getUser");
    expect(metodo?.kind).toBe("method");
    expect(metodo?.parent).toBe("UsersController");
  });

  test("cada decorador conserva nombre, objetivo y argumentos", () => {
    const document = typescriptFrontend.parse(FUENTE, "src/users.controller.ts");
    const controller = document.decorators.find((d) => d.name === "Controller");
    expect(controller?.target).toBe("UsersController");
    expect(controller?.args[0]).toEqual({ kind: "string", value: "/users" });

    const get = document.decorators.find((d) => d.name === "Get");
    expect(get?.target).toBe("getUser");
    expect(get?.args[0]).toEqual({ kind: "string", value: ":id" });
  });

  test("la posición del símbolo es la de la fuente", () => {
    // Sin decorador en la clase: el nodo empieza en la línea de la
    // declaración. (Con decorador, el nodo de la clase empieza en el
    // decorador — el decorador forma parte del nodo.)
    const document = typescriptFrontend.parse(
      [
        "export class UsersController {",
        "  getUser() { return {}; }",
        "}",
      ].join("\n"),
      "src/users.controller.ts",
    );
    const clase = document.symbols.find((s) => s.name === "UsersController");
    expect(clase?.location.line).toBe(1);
    expect(clase?.location.file).toBe("src/users.controller.ts");

    const metodo = document.symbols.find((s) => s.name === "getUser");
    expect(metodo?.location.line).toBe(2);
  });
});

describe("las seis formas de callee sobreviven estructuradas", () => {
  const FUENTE = [
    "app.get('/a', h);",
    "this.router.post('/b', h);",
    "api.router.put('/c', h);",
    "getRouter().delete('/d', h);",
    "server['get']('/e', h);",
    "router?.patch('/f', h);",
  ].join("\n");

  test("cada forma llega con su receiverKind", () => {
    const document = typescriptFrontend.parse(FUENTE, "src/routes.ts");
    const kinds = document.calls.map((call) => call.receiverKind);
    expect(kinds).toContain("identifier");
    expect(kinds).toContain("this");
    expect(kinds).toContain("member");
    expect(kinds).toContain("factory");
    expect(kinds).toContain("computed");
    expect(kinds).toContain("optional");
  });

  test("el verbo llega en `method`, sin partir el callee", () => {
    const document = typescriptFrontend.parse(FUENTE, "src/routes.ts");
    const verbs = document.calls
      .map((call) => call.method ?? call.resolvedMethod ?? "")
      .filter((verb) => verb.length > 0);
    expect(verbs).toContain("get");
    expect(verbs).toContain("post");
    expect(verbs).toContain("put");
    expect(verbs).toContain("delete");
    expect(verbs).toContain("patch");
  });

  test("el receptor llega separado del método", () => {
    const document = typescriptFrontend.parse(FUENTE, "src/routes.ts");
    const delThis = document.calls.find((call) => call.receiverKind === "this");
    expect(delThis?.receiver).toBe("this.router");
    expect(delThis?.method).toBe("post");
  });
});

describe("el refactor es invisible para los consumidores actuales", () => {
  test("parse() sigue devolviendo el TSFile de siempre", () => {
    const file = parse(`import express from "express";`, "server.ts");
    expect(file.imports).toHaveLength(1);
    expect(file.imports[0]?.source).toBe("express");
    expect(file.filename).toBe("server.ts");
    expect(Array.isArray(file.symbols)).toBe(true);
    expect(Array.isArray(file.methodCalls)).toBe(true);
    expect(Array.isArray(file.decorators)).toBe(true);
  });

  test("extractRoutes() sigue extrayendo las rutas de siempre", () => {
    const resultado = extractRoutes(
      ["const app = express();", "app.get('/users', h);"].join("\n"),
      "server.ts",
      "express",
    );
    expect(resultado.routes).toHaveLength(1);
    expect(resultado.routes[0]?.path).toBe("/users");
    expect(resultado.routes[0]?.method).toBe("GET");
  });

  test("las dos vistas salen del mismo parse", () => {
    const fuente = ["app.get('/users', h);"].join("\n");
    const file = parse(fuente, "server.ts");
    const document = typescriptFrontend.parse(fuente, "server.ts");
    expect(file.methodCalls).toHaveLength(1);
    expect(document.calls).toHaveLength(1);
  });
});

describe("ningún consumidor del IR usa implementaciones concretas", () => {
  test("ningún scanner menciona un parser concreto", async () => {
    const acana: string[] = [];
    for (const carpeta of CARPETAS) {
      for (const fichero of await ficherosDe(carpeta)) {
        const source = await readFile(fichero, "utf8");
        source.split("\n").forEach((linea, indice) => {
          if (PROHIBIDO.test(linea)) {
            acana.push(
              `${relative(RAIZ, fichero)}:${indice + 1} — ${linea.trim()}`,
            );
          }
        });
      }
    }
    expect(acana).toEqual([]);
  });

  test("ningún scanner importa el frontend de un lenguaje concreto", async () => {
    const acana: string[] = [];
    for (const carpeta of CARPETAS) {
      for (const fichero of await ficherosDe(carpeta)) {
        const source = await readFile(fichero, "utf8");
        for (const match of source.matchAll(/from\s*["']([^"']+)["']/g)) {
          const spec = match[1] ?? "";
          if (/@babel\/|["'](?:typescript|ts-node)["']/.test(spec)) {
            acana.push(`${relative(RAIZ, fichero)} → ${spec}`);
          }
        }
      }
    }
    expect(acana).toEqual([]);
  });
});
