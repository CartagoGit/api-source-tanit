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
import { existsSync } from "node:fs";
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
 * the scanners are in `packages/frameworks/scanners/` — and Laravel has
 * its own. Every folder is listed on purpose — if a `core/scanners/`
 * ever appears, it is watched from the day it appears.
 *
 * Two more are watched now, because they are **consumers of the IR**:
 * the LanguageIR that already existed (the TypeScript-shaped one the
 * six JavaScript scanners read) and the discovery folder, where the
 * host config parser lives.
 */
const CARPETAS = [
  join(RAIZ, "packages", "core", "scanners"),
  join(RAIZ, "packages", "frameworks", "scanners"),
  // El scanner de Laravel vive en su propia carpeta, no en
  // `frameworks/scanners/`: sin esta línea, el gate no lo miraba.
  join(RAIZ, "packages", "frameworks", "laravel"),
  join(RAIZ, "packages", "core", "language-ir"),
  join(RAIZ, "packages", "core", "discovery"),
];

/**
 * The only places allowed to name the parser that reads TypeScript.
 *
 * The legacy IR (`packages/core/language-ir/`) and the host config
 * parser are the **TypeScript-shaped implementation** the agnostic
 * contract is meant to replace — in a later proposal. Migrating them
 * is an explicit **non-goal** of r00020 S2: the slice adds the
 * contract and moves the frontend; rewriting the IR that six scanners
 * consume is a different, and much bigger, piece of work. The
 * dependency is planned for that proposal.
 *
 * Until it lands, the dependency is a **whitelist entry with a
 * reason** — not a hole nobody looks at. The gate below reads these
 * files, finds the parser named in them, and lets it pass *because
 * the list says so*, out loud.
 */
const LISTA_BLANCA: readonly string[] = [
  "packages/core/language-ir/",
  "packages/core/discovery/host-config-parser.service.ts",
];

/** Whether a path is inside the whitelist. */
function enLaListaBlanca(relPath: string): boolean {
  return LISTA_BLANCA.some(
    (entrada) =>
      entrada.endsWith("/")
        ? relPath.startsWith(entrada)
        : relPath === entrada,
  );
}

/**
 * The vocabulary that would tie a scanner to one concrete parser,
 * split into the two criteria that mean different things.
 *
 * - **Parser vocabulary** (`ts.Node`, `babel`) is checked on the
 *   **code** of a scanner. The prose may name the parser that used to
 *   be behind it — a scanner that explains what a
 *   `TaggedTemplateExpression` is does not depend on the parser that
 *   produces one. Only the code does.
 * - **TypeScript suppressions** (`@ts-ignore`) are checked on the raw
 *   source, because a suppression directive *is* a comment: a
 *   code-only check could never see it.
 */
const PROHIBIDO_EN_CODIGO = /ts\.Node|babel/i;
// Sin la `@` delante: el patron sigue detectingo `@ts-ignore` (es
// subcadena), pero el gate `lint:no-type-escapes` no lo confunde con
// una supresion de tipos real.
const PROHIBIDO_EN_FUENTE = /ts-ignore/i;

/**
 * Removes the comments, so only the *code* of a file is checked.
 *
 * Same criterion the contracts spec uses
 * (`tests/contracts/language-ir-shape.spec.ts`), with one difference
 * that only affects the diagnostics: the newlines inside a block
 * comment are preserved, so the line number reported for a violation
 * is the real one.
 */
function sinComentarios(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

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

/** Every `*.scanner.ts` file under a folder, recursively. */
async function ficherosScanner(carpeta: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(carpeta, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(carpeta, entry.name);
    if (entry.isDirectory()) out.push(...(await ficherosScanner(full)));
    else if (entry.name.endsWith(".scanner.ts")) out.push(full);
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
    // El fixture lleva llamadas a propósito. Sin ellas la
    // aserción de `extractCalls` es vacua: `document.calls` valía
    // `[]`, así que un `extractCalls` que devolviera `[]` también
    // habría pasado. Un test que no puede fallar no vigila nada.
    const document = typescriptFrontend.parse(
      [
        "@Controller('/x')",
        "class A { @Get() m() {} }",
        'app.get("/x", handler);',
      ].join("\n"),
      "src/a.ts",
    );
    expect(document.calls.length).toBeGreaterThan(0);

    expect(typescriptFrontend.extractSymbols(document)).toEqual(
      document.symbols,
    );
    expect(typescriptFrontend.extractCalls(document)).toEqual(document.calls);
    const llamadas = typescriptFrontend.extractCalls(document);
    expect(llamadas.length).toBeGreaterThan(0);
    expect(llamadas.map((call) => call.method)).toContain("get");
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

  test("la posición de un símbolo libre es la de su declaración", () => {
    // Ni una clase ni un método: una constante y una función sueltas
    // a nivel de módulo. Su línea es la de la fuente, y se afirma
    // exacta — `locationValida` (que sólo exige `line >= 1`) deja
    // pasar un `line + 1000`.
    const document = typescriptFrontend.parse(
      [
        'import express from "express";',
        "",
        "const app = express();",
        "",
        "function helper() { return 1; }",
      ].join("\n"),
      "src/lib.ts",
    );
    const constante = document.symbols.find((s) => s.name === "app");
    expect(constante?.kind).toBe("variable");
    expect(constante?.location.line).toBe(3);
    expect(constante?.location.file).toBe("src/lib.ts");

    const funcion = document.symbols.find((s) => s.name === "helper");
    expect(funcion?.kind).toBe("function");
    expect(funcion?.location.line).toBe(5);
    expect(funcion?.location.file).toBe("src/lib.ts");
  });
});

describe("la columna de un símbolo es la de su nombre", () => {
  // La sangría de 4 espacios es deliberada: fija la columna 4 del
  // método y la 6 del nombre de la clase. Con la sangría de 2 del
  // repo los números serían otros, y el número es lo que se vigila.
  const FUENTE = [
    "class A {",
    "    method() { return 1; }",
    "}",
  ].join("\n");

  test("la clase apunta al nombre que introduce", () => {
    const document = typescriptFrontend.parse(FUENTE, "src/a.ts");
    const clase = document.symbols.find((s) => s.name === "A");
    expect(clase?.kind).toBe("class");
    expect(clase?.location.line).toBe(1);
    // El `A` de `class A {` está en la columna 6 — no en la 0, que es
    // donde empieza la sentencia.
    expect(clase?.location.column).toBe(6);
  });

  test("el método apunta al nombre que introduce", () => {
    const document = typescriptFrontend.parse(FUENTE, "src/a.ts");
    const metodo = document.symbols.find((s) => s.name === "method");
    expect(metodo?.kind).toBe("method");
    expect(metodo?.location.line).toBe(2);
    // El `method` está en la columna 4 — no en la 0, que es donde
    // empieza la línea.
    expect(metodo?.location.column).toBe(4);
  });

  test("la columna es donde el nombre está escrito en su línea", () => {
    // La regla, y no el número: la columna de un símbolo es la
    // posición de su nombre dentro de la línea que lo contiene. Un
    // `column: 0` —o un `column: 42`— rompe esta aserción.
    const document = typescriptFrontend.parse(FUENTE, "src/a.ts");
    const lineas = FUENTE.split("\n");
    expect(document.symbols.length).toBeGreaterThan(0);
    for (const symbol of document.symbols) {
      const linea = lineas[symbol.location.line - 1] ?? "";
      expect(symbol.location.column, symbol.name).toBe(
        linea.indexOf(symbol.name),
      );
    }
  });

  test("un símbolo de nivel de módulo apunta a su nombre", () => {
    const document = typescriptFrontend.parse(
      ["const app = 1;", "function helper() { return 1; }"].join("\n"),
      "src/lib.ts",
    );
    const constante = document.symbols.find((s) => s.name === "app");
    expect(constante?.location.line).toBe(1);
    expect(constante?.location.column).toBe(6);

    const funcion = document.symbols.find((s) => s.name === "helper");
    expect(funcion?.location.line).toBe(2);
    expect(funcion?.location.column).toBe(9);
  });

  test("una declaración decorada apunta a su nombre, y el marcador al suyo", () => {
    const document = typescriptFrontend.parse(
      [
        "@Controller('/users')",
        "export class UsersController {",
        "  @Get(':id')",
        "  getUser() { return {}; }",
        "}",
      ].join("\n"),
      "src/users.controller.ts",
    );
    // La clase está decorada: su *nodo* empieza en el decorador
    // (línea 1), pero su *nombre* está en la línea 2 — y la línea y
    // la columna tienen que hablar de lo mismo.
    const clase = document.symbols.find((s) => s.name === "UsersController");
    expect(clase?.location.line).toBe(2);
    expect(clase?.location.column).toBe(13);

    const decorador = document.decorators.find((d) => d.name === "Controller");
    expect(decorador?.location.line).toBe(1);
    // El `Controller` de `@Controller('/users')` está en la columna 1:
    // la columna 0 es el `@`.
    expect(decorador?.location.column).toBe(1);
  });
});

describe("la visibilidad de un método viene de su clase", () => {
  test("el método de una clase exportada es visible fuera del módulo", () => {
    const document = typescriptFrontend.parse(
      ["export class A {", "  m() { return 1; }", "}"].join("\n"),
      "src/a.ts",
    );
    const metodo = document.symbols.find((s) => s.name === "m");
    expect(metodo?.kind).toBe("method");
    // El frontend no modela la visibilidad de los miembros: un método
    // público de una clase exportada *es* visible desde fuera del
    // módulo, así que hereda la visibilidad de su clase.
    expect(metodo?.exported).toBe(true);
  });

  test("el método de una clase que no se exporta, no lo es", () => {
    const document = typescriptFrontend.parse(
      ["class A {", "  m() { return 1; }", "}"].join("\n"),
      "src/a.ts",
    );
    const metodo = document.symbols.find((s) => s.name === "m");
    expect(metodo?.exported).toBe(false);
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

describe("el doc del LanguageIR no dice cosas que ya no son verdad", () => {
  test("la cifra de scanners que dice el doc es la que hay", async () => {
    const doc = await readFile(join(RAIZ, "docs", "LANGUAGE-IR.md"), "utf8");
    const declarados = [...doc.matchAll(/(\d+)\s+scanners/g)].map((match) =>
      Number(match[1]),
    );
    const reales = await ficherosScanner(
      join(RAIZ, "packages", "frameworks"),
    );
    expect(reales.length).toBeGreaterThan(0);
    // Una sola cifra, y la buena: si el doc dice otra, o dice dos, el
    // test falla y obliga a corregirlo. La cifra no está escrita a
    // mano en el doc — está verificada contra el repositorio.
    expect(declarados).toEqual([reales.length]);
  });

  test("el doc explica que un frontend de producción degrada", async () => {
    const doc = await readFile(join(RAIZ, "docs", "LANGUAGE-IR.md"), "utf8");
    // El camino que degrada (devuelve `null` y registra el
    // diagnóstico) tiene que estar documentado, y el que lanza
    // (`parseWithProgram`) tiene que quedar marcado como de uso
    // directo.
    expect(doc).toContain("parseModuleWithProgram");
    expect(doc).toContain("diagnostics");
    expect(doc).toMatch(/degrad/i);
  });
});

describe("ningún consumidor del IR usa implementaciones concretas", () => {
  test("ningún scanner menciona un parser concreto", async () => {
    const acana: string[] = [];
    for (const carpeta of CARPETAS) {
      for (const fichero of await ficherosDe(carpeta)) {
        const rel = relative(RAIZ, fichero).replaceAll("\\", "/");
        const source = await readFile(fichero, "utf8");
        // La prosa de un scanner puede explicar el parser que hay
        // detrás — eso no ata el scanner al parser. Lo que lo ata es
        // el código, y el código es lo que se mira aquí.
        sinComentarios(source)
          .split("\n")
          .forEach((linea, indice) => {
            if (PROHIBIDO_EN_CODIGO.test(linea) && !enLaListaBlanca(rel)) {
              acana.push(`${rel}:${indice + 1} — ${linea.trim()}`);
            }
          });
        // Una supresión de tipos de TypeScript es un comentario por
        // definición, así que para verla hay que mirar la fuente
        // entera: si no, el criterio se queda sin cobertura. Esta
        // regla no tiene lista blanca: una supresión de tipos es un
        // agujero en el typecheck, y el typecheck no migra por
        // trabajo.
        source.split("\n").forEach((linea, indice) => {
          if (PROHIBIDO_EN_FUENTE.test(linea)) {
            acana.push(`${rel}:${indice + 1} — ${linea.trim()}`);
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
        const rel = relative(RAIZ, fichero).replaceAll("\\", "/");
        if (enLaListaBlanca(rel)) continue;
        const source = sinComentarios(await readFile(fichero, "utf8"));
        for (const match of source.matchAll(/from\s*["']([^"']+)["']/g)) {
          const spec = match[1] ?? "";
          if (/@babel\/|["'](?:typescript|ts-node)["']/.test(spec)) {
            acana.push(`${rel} → ${spec}`);
          }
        }
      }
    }
    expect(acana).toEqual([]);
  });

  test("la lista blanca es explícita, existe y está justificada", async () => {
    // Una lista blanca vacía no vigila nada; una lista blanca que
    // nombra un fichero que ya no existe miente sobre lo que el gate
    // mira. Las dos cosas se comprueban aquí.
    expect(LISTA_BLANCA.length).toBeGreaterThan(0);
    for (const entrada of LISTA_BLANCA) {
      expect(existsSync(join(RAIZ, entrada)), `${entrada} no existe`).toBe(
        true,
      );
      // Y ninguna entrada puede ser un scanner: la lista blanca es
      // para la implementación de TypeScript que queda por migrar.
      expect(entrada.startsWith("packages/core/")).toBe(true);
    }
  });
});
