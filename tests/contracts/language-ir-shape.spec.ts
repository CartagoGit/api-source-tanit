/**
 * The agnostic frontend contract — and the promise it makes.
 *
 * Two things are checked here, and they are the two halves of the
 * slice:
 *
 * 1. **The contract is agnostic.** The five interfaces of
 *    `packages/contracts/interfaces/language-ir/` describe source code
 *    without naming any language. The check strips the comments (a
 *    contract is *allowed* to mention TypeScript while explaining why
 *    it does not depend on TypeScript) and then looks at what is
 *    left: the type surface and the imports. A contract that reached
 *    for `TSFile` or for `@babel/types` would fail here.
 *
 * 2. **The shape holds.** The TypeScript IR is projected onto the
 *    contract and every symbol, call and decorator is checked against
 *    it. And a frontend for a language that does not exist yet — one
 *    written here, in the test, with no parser at all — is built
 *    against the same contract. If a future language cannot be
 *    expressed with these five interfaces, the contract is wrong, and
 *    this test is where it shows.
 *
 * (r00020 S2 — LanguageIR agnostic foundation)
 */
import { describe, expect, test } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { typescriptFrontend } from "../../packages/core/language-frontends/typescript/typescript-frontend.helper.js";
import type {
  IArgumentValue,
  ICallExpression,
  IDecorator,
  ILanguageDocument,
  ILanguageFrontend,
  ISymbol,
} from "../../packages/contracts/interfaces/language-ir/language-ir.interface.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = join(AQUI, "..", "..", "packages", "contracts");
const LANGUAGE_IR = join(CONTRACTS, "interfaces", "language-ir");

/**
 * The five interfaces the slice promises, and the file each one lives
 * in. The list is written by hand on purpose: a barrel that quietly
 * stops exporting one of them must break this test, not the readers
 * of a documentation page.
 */
const INTERFACES_POR_FICHERO: ReadonlyArray<{
  readonly file: string;
  readonly names: ReadonlyArray<string>;
}> = [
  {
    file: "frontend.interface.ts",
    names: ["ILanguageFrontend", "ILanguageDocument"],
  },
  { file: "symbol.interface.ts", names: ["ISymbol", "SymbolKind"] },
  {
    file: "call.interface.ts",
    names: ["ICallExpression", "IArgumentValue", "CallReceiverKind", "ArgumentKind"],
  },
  { file: "decorator.interface.ts", names: ["IAttribute", "IDecorator"] },
  { file: "location.interface.ts", names: ["ILocation"] },
];

/**
 * Vocabulary that would tie the contract to one language.
 *
 * `ts` and `babel` are the two names the repository actually uses for
 * the concrete implementations (`ts.Node` in the compiler's API,
 * `@babel/types` in the parser's). The `TS*` prefix is what the
 * TypeScript-flavoured contracts of this repository are named after
 * (`TSFile`, `TSSymbol`, `TSMethodCall`, `TSDecorator`, `TSLiteral`).
 */
const IDENTIFICADORES_PROHIBIDOS: ReadonlySet<string> = new Set([
  "ts",
  "tsnode",
  "babel",
  "babelnode",
  "estree",
  "typescript",
  "javascript",
  "tsfile",
  "tssymbol",
  "tsmethodcall",
  "tsdecorator",
  "tsliteral",
  "tsclass",
  "tsimport",
  "tsassignment",
]);

/**
 * Import specifiers that would drag a concrete implementation into a
 * contract. A contract that imports from `core/` is not a contract —
 * it is the signature of an implementation with another name.
 */
const IMPORTES_PROHIBIDOS: readonly string[] = [
  "typescript",
  "babel",
  "estree",
  "ts.",
  "/ts/",
];

/**
 * Removes the comments, so only the *code* of a contract is checked.
 *
 * A contract is allowed to say "the TypeScript frontend implements
 * this"; what it may not do is *depend* on TypeScript.
 */
function sinComentarios(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The identifiers that appear in the code of a contract. */
function identificadores(source: string): Set<string> {
  const limpio = sinComentarios(source);
  const encontrados = new Set<string>();
  for (const match of limpio.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const id = match[0];
    if (id) encontrados.add(id);
  }
  return encontrados;
}

/** The relative import specifiers of a contract. */
function importes(source: string): string[] {
  const limpio = sinComentarios(source);
  const encontrados: string[] = [];
  for (const match of limpio.matchAll(/from\s*["']([^"']+)["']/g)) {
    const spec = match[1];
    if (spec) encontrados.push(spec);
  }
  return encontrados;
}

/** Every `.ts` file of the language-ir folder. */
async function ficherosDelContrato(): Promise<string[]> {
  const entries = await readdir(LANGUAGE_IR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(LANGUAGE_IR, entry.name));
}

/**
 * Checks that a value has the shape the contract asks for.
 *
 * It is written as a *runtime* check and not only as a type
 * annotation on purpose: an interface disappears at runtime, so a
 * contract could declare a field and no frontend would ever fill it.
 * These assertions are the ones that catch it.
 */
function locationValida(location: {
  file: string;
  line: number;
  column: number;
}): boolean {
  return (
    typeof location.file === "string" &&
    location.file.length > 0 &&
    Number.isInteger(location.line) &&
    location.line >= 1 &&
    Number.isInteger(location.column) &&
    location.column >= 0
  );
}

describe("packages/contracts/interfaces/language-ir/ — el contrato agnóstico", () => {
  test("declara las cinco interfaces en sus cinco ficheros", async () => {
    const existentes = await ficherosDelContrato();
    expect(existentes.length).toBeGreaterThanOrEqual(
      INTERFACES_POR_FICHERO.length,
    );

    for (const entrada of INTERFACES_POR_FICHERO) {
      const ruta = join(LANGUAGE_IR, entrada.file);
      const source = await readFile(ruta, "utf8");
      for (const nombre of entrada.names) {
        const declarado = new RegExp(
          `export\\s+(?:interface|type)\\s+${nombre}\\b`,
        ).test(source);
        expect(
          declarado,
          `${entrada.file} debería declarar ${nombre}`,
        ).toBe(true);
      }
    }
  });

  test("el barrel reexporta las cinco interfaces", async () => {
    const barrel = await readFile(
      join(LANGUAGE_IR, "language-ir.interface.ts"),
      "utf8",
    );
    for (const entrada of INTERFACES_POR_FICHERO) {
      for (const nombre of entrada.names) {
        const reexportado = new RegExp(
          `export\\s+type\\s*\\{[^}]*\\b${nombre}\\b[^}]*\\}`,
          "s",
        ).test(barrel);
        expect(
          reexportado,
          `el barrel debería reexportar ${nombre}`,
        ).toBe(true);
      }
    }
  });

  test("ningún contrato usa vocabulario de un lenguaje concreto", async () => {
    for (const fichero of await ficherosDelContrato()) {
      const source = await readFile(fichero, "utf8");
      const prohibidos = [...identificadores(source)].filter((id) =>
        IDENTIFICADORES_PROHIBIDOS.has(id.toLowerCase()),
      );
      expect(
        prohibidos,
        `${fichero} nombra algo específico de un lenguaje: ${prohibidos.join(", ")}`,
      ).toEqual([]);
    }
  });

  test("ningún contrato importa una implementación concreta", async () => {
    for (const fichero of await ficherosDelContrato()) {
      const source = await readFile(fichero, "utf8");
      const sospechosos = importes(source).filter((spec) =>
        IMPORTES_PROHIBIDOS.some((prohibido) => spec.includes(prohibido)),
      );
      expect(
        sospechosos,
        `${fichero} importa algo específico de un lenguaje: ${sospechosos.join(", ")}`,
      ).toEqual([]);
    }
  });

  test("las uniones cerradas del contrato no se ensanchan por accidente", async () => {
    const simbolo = await readFile(
      join(LANGUAGE_IR, "symbol.interface.ts"),
      "utf8",
    );
    const llamada = await readFile(join(LANGUAGE_IR, "call.interface.ts"), "utf8");

    const kinds = (source: string, tipo: string): string[] => {
      const match = new RegExp(
        `export\\s+type\\s+${tipo}\\s*=([^;]+);`,
        "s",
      ).exec(source);
      if (!match?.[1]) return [];
      return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
    };

    expect(kinds(simbolo, "SymbolKind")).toEqual([
      "function",
      "class",
      "method",
      "variable",
      "constant",
      "property",
      "type",
      "module",
    ]);
    expect(kinds(llamada, "CallReceiverKind")).toEqual([
      "identifier",
      "this",
      "member",
      "factory",
      "computed",
      "optional",
    ]);
    expect(kinds(llamada, "ArgumentKind")).toEqual([
      "string",
      "number",
      "boolean",
      "null",
      "undefined",
      "identifier",
      "object",
      "array",
      "callable",
      "unknown",
    ]);
  });
});

describe("el IR de TypeScript cumple el contrato agnóstico", () => {
  const FUENTE = [
    'import express from "express";',
    "",
    'const app = express();',
    "",
    "app.get(\"/users\", (req, res) => { res.send(\"ok\"); });",
    "this.router.post(\"/users\", handler);",
    'server["get"]("/ping", handler);',
  ].join("\n");

  test("el documento tiene la forma que el contrato declara", () => {
    const document = typescriptFrontend.parse(FUENTE, "src/server.ts");
    expect(document.languageId).toBe("typescript");
    expect(document.filename).toBe("src/server.ts");
    expect(Array.isArray(document.symbols)).toBe(true);
    expect(Array.isArray(document.calls)).toBe(true);
    expect(Array.isArray(document.decorators)).toBe(true);
  });

  test("cada símbolo cumple ISymbol", () => {
    const document = typescriptFrontend.parse(FUENTE, "src/server.ts");
    for (const symbol of document.symbols) {
      expect(typeof symbol.name).toBe("string");
      expect(symbol.name.length).toBeGreaterThan(0);
      expect(["function", "class", "method", "variable", "constant", "property", "type", "module"]).toContain(
        symbol.kind,
      );
      expect(typeof symbol.exported).toBe("boolean");
      expect(locationValida(symbol.location)).toBe(true);
      expect(symbol.location.file).toBe("src/server.ts");
    }
  });

  test("cada llamada cumple ICallExpression", () => {
    const document = typescriptFrontend.parse(FUENTE, "src/server.ts");
    expect(document.calls.length).toBeGreaterThan(0);
    for (const call of document.calls) {
      expect(typeof call.callee).toBe("string");
      expect([
        "identifier",
        "this",
        "member",
        "factory",
        "computed",
        "optional",
      ]).toContain(call.receiverKind);
      expect(Array.isArray(call.args)).toBe(true);
      expect(locationValida(call.location)).toBe(true);
      // El fichero exacto, como se afirma para los símbolos y los
      // decoradores: `locationValida` sólo exige un string no vacío,
      // así que un `file` equivocado pasaba el test.
      expect(call.location.file).toBe("src/server.ts");
      for (const argument of call.args) {
        expect([
          "string",
          "number",
          "boolean",
          "null",
          "undefined",
          "identifier",
          "object",
          "array",
          "callable",
          "unknown",
        ]).toContain(argument.kind);
      }
    }
  });

  test("cada decorador cumple IDecorator", () => {
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
    expect(document.decorators.length).toBeGreaterThan(0);
    for (const decorator of document.decorators) {
      expect(typeof decorator.name).toBe("string");
      expect(decorator.name.length).toBeGreaterThan(0);
      expect(typeof decorator.target).toBe("string");
      expect(Array.isArray(decorator.args)).toBe(true);
      expect(locationValida(decorator.location)).toBe(true);
      expect(decorator.location.file).toBe("src/users.controller.ts");
    }
    const nombres = document.decorators.map((decorator) => decorator.name);
    expect(nombres).toContain("Controller");
    expect(nombres).toContain("Get");
  });
});

describe("un frontend de otro lenguaje cabe en el mismo contrato", () => {
  /**
   * A frontend for a language that does not exist yet in this
   * repository, written here with no parser at all: it returns what it
   * is told. If the contract could not express it, the contract would
   * be the thing that has to change before the second frontend is
   * written — and that is exactly what this test is for.
   */
  const pythonFrontend: ILanguageFrontend = {
    languageId: "python",
    parse(_source: string, filename: string): ILanguageDocument {
      const symbols: ISymbol[] = [
        {
          name: "list_users",
          kind: "function",
          exported: false,
          location: { file: filename, line: 1, column: 0 },
        },
      ];
      const calls: ICallExpression[] = [
        {
          callee: "app.get",
          receiver: "app",
          receiverKind: "identifier",
          method: "get",
          args: [
            { kind: "string", value: "/users" },
            { kind: "identifier", identifierName: "list_users" },
          ],
          location: { file: filename, line: 2, column: 4 },
        },
      ];
      const decorators: IDecorator[] = [
        {
          name: "router",
          args: [{ kind: "string", value: "/users" }],
          target: "list_users",
          location: { file: filename, line: 1, column: 0 },
        },
      ];
      return { languageId: "python", filename, symbols, calls, decorators };
    },
    extractSymbols(document: ILanguageDocument): ReadonlyArray<ISymbol> {
      return document.symbols;
    },
    extractCalls(document: ILanguageDocument): ReadonlyArray<ICallExpression> {
      return document.calls;
    },
    extractDecorators(document: ILanguageDocument): ReadonlyArray<IDecorator> {
      return document.decorators;
    },
  };

  test("un frontend que no es TypeScript implementa el contrato entero", () => {
    expect(pythonFrontend.languageId).toBe("python");
    const document = pythonFrontend.parse("", "api/routes.py");
    expect(pythonFrontend.extractSymbols(document)).toHaveLength(1);
    expect(pythonFrontend.extractCalls(document)).toHaveLength(1);
    expect(pythonFrontend.extractDecorators(document)).toHaveLength(1);
    expect(pythonFrontend.extractCalls(document)[0]?.args[0]).toEqual({
      kind: "string",
      value: "/users",
    });
  });

  test("los dos frontends son intercambiables para un consumidor", () => {
    const consumers: ReadonlyArray<ILanguageFrontend> = [
      typescriptFrontend,
      pythonFrontend,
    ];
    for (const frontend of consumers) {
      const document = frontend.parse("", "src/routes.ts");
      const argumentos: ReadonlyArray<IArgumentValue> =
        frontend.extractCalls(document).flatMap((call) => call.args);
      expect(argumentos.every((argument) => typeof argument.kind === "string")).toBe(
        true,
      );
    }
  });
});
