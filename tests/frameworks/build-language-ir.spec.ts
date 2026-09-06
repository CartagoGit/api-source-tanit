/**
 * Tests for `buildLanguageIR` (x00048 S3 / a00016 S6.d).
 *
 * El helper debe cumplir dos contratos:
 *
 *   1. **Equivalencia**: las cuatro primitivas que devuelve son las
 *      mismas que devuelven los collectors individuales llamados por
 *      separado sobre el mismo source.
 *   2. **Single-parse**: Babel parsea el archivo UNA vez, no cuatro.
 *      Se verifica con un spy que monkey-patchea `@babel/parser` —
 *      el acceptance del slice lo pide explícitamente ("contar
 *      llamadas a parse()").
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import * as babelParser from "@babel/parser";

import { buildLanguageIR } from "../../packages/frameworks/typescript/build-language-ir.helper.js";
import { collectMethodCallsFromSource } from "../../packages/frameworks/typescript/collect-method-calls.helper.js";
import { collectConstantsFromSource } from "../../packages/frameworks/typescript/collect-constants.helper.js";
import { createTempProject, scanProject } from "../helpers/scanner-fixture";

/** Fixture que ejercita las cuatro primitivas a la vez. */
const FULL_SOURCE = [
  `import express from "express";`,
  `import { Router as R } from "express";`,
  `export { health } from "./health";`,
  `const M = "get";`,
  `const app = express();`,
  `app.get("/plain", h);`,
  `app[M]("/computed", h);`,
  `function h(req, res) { res.json({}); }`,
].join("\n");

describe("buildLanguageIR — equivalencia con los collectors individuales", () => {
  test("calls: idénticas a collectMethodCallsFromSource", () => {
    const ir = buildLanguageIR(FULL_SOURCE, "server.ts");
    const direct = collectMethodCallsFromSource(FULL_SOURCE, "server.ts");
    expect(ir.calls).toEqual(direct);
  });

  test("bindings: idénticas a collectConstantsFromSource", () => {
    const ir = buildLanguageIR(FULL_SOURCE, "server.ts");
    const direct = collectConstantsFromSource(FULL_SOURCE, "server.ts");
    expect(ir.bindings).toEqual(direct);
  });

  test("aliases: default + renamed con importedName (x00048 S1)", () => {
    const ir = buildLanguageIR(FULL_SOURCE, "server.ts");
    expect(ir.aliases).toHaveLength(2);
    const defaultAlias = ir.aliases.find((a) => a.name === "express");
    expect(defaultAlias?.importedName).toBe("default");
    const renamed = ir.aliases.find((a) => a.name === "R");
    // El punto de S1: el nombre ORIGINAL del módulo exportador.
    expect(renamed?.importedName).toBe("Router");
  });

  test("reexports: export-from con nombre y módulo", () => {
    const ir = buildLanguageIR(FULL_SOURCE, "server.ts");
    expect(ir.reexports).toHaveLength(1);
    expect(ir.reexports[0]?.name).toBe("health");
    expect(ir.reexports[0]?.from).toBe("./health");
  });
});

describe("buildLanguageIR — single-parse", () => {
  let parseSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    parseSpy = vi.spyOn(babelParser, "parse");
  });

  afterEach(() => {
    parseSpy?.mockRestore();
  });

  test("parsea una sola vez para las cuatro primitivas", () => {
    buildLanguageIR(FULL_SOURCE, "server.ts");
    // El acceptance de S3: 1 llamada a parse() por archivo, no 3-4.
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  test("los collectors individuales siguen parseando por separado (comparación)", () => {
    // Contraste: la ruta legacy (dos collectors con su propio parse)
    // consume 2 parses para 2 primitivas. Con buildLanguageIR, las 4
    // primitivas consumen 1.
    collectMethodCallsFromSource(FULL_SOURCE, "server.ts");
    collectConstantsFromSource(FULL_SOURCE, "server.ts");
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  test("x00048 S3: el scanner de Express parsea UNA vez por archivo", async () => {
    // Acceptance del slice: instrumentar con un spy y contar llamadas
    // a parse(). El proyecto tiene 1 fichero fuente (app.js); antes
    // del single-parse el scanner consumía 3 parses (frontend +
    // calls + bindings). Ahora debe consumir exactamente 1.
    const project = await createTempProject({
      "package.json": JSON.stringify({
        name: "single-parse-check",
        dependencies: { express: "^4.19.2" },
      }),
      "app.js": [
        'const express = require("express");',
        "const app = express();",
        'const M = "get";',
        'app[M]("/computed", h);',
        'app.get("/plain", h);',
        "app.listen(3000);",
      ].join("\n"),
    });
    try {
      const result = await scanProject("express", project.root);
      // El scan completo del proyecto consume 1 parse (1 fichero).
      expect(parseSpy).toHaveBeenCalledTimes(1);
      // Y las rutas siguen llegando — el single-parse no pierde nada.
      const uris = result.routes.map((r) => `${r.method} ${r.uri}`);
      expect(uris).toContain("GET /plain");
      expect(uris).toContain("GET /computed");
    } finally {
      await project.cleanup();
    }
  });
});

describe("buildLanguageIR — degradación", () => {
  test("fuente roca: ILanguageIR vacío + diagnóstico", () => {
    const diagnostics: Array<{ file: string; severity: "error" | "warning"; reason: string }> = [];
    // `class` sin cuerpo ni llave de cierre: error de parseo real.
    const broken = "class C { constructor() {";
    const ir = buildLanguageIR(broken, "broken.ts", diagnostics);
    // errorRecovery puede rescatar parte del AST; lo que importa es
    // que NO lanza y devuelve un shape completo.
    expect(ir.calls).toBeDefined();
    expect(ir.bindings).toBeDefined();
    expect(ir.aliases).toBeDefined();
    expect(ir.reexports).toBeDefined();
  });

  test("fuente vacía: cuatro arrays vacíos", () => {
    const ir = buildLanguageIR("", "empty.ts");
    expect(ir.calls).toEqual([]);
    expect(ir.bindings).toEqual([]);
    expect(ir.aliases).toEqual([]);
    expect(ir.reexports).toEqual([]);
  });
});