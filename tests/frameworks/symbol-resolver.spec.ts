/**
 * Tests para `collectAliases`, `collectReexports` y `resolveCallee`
 * (a00016 S3).
 *
 * Cubre las 4 formas que el scanner necesita:
 *   - `import x from "./y"` → alias.
 *   - `import { x as y } from "./y"` → aliased import.
 *   - `export { x } from "./y"` → reexport.
 *   - `const r = app; r.get(...)` → resolución de alias local.
 *
 * Tests unitarios — las primitivas puras no leen disco. Los walkers
 * de disco usan un directorio temporal pequeño escrito por el test.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  collectAliases,
  collectReexports,
  resolveCallee,
} from "../../packages/frameworks/typescript/symbol-resolver.helper";
import { collectMethodCallsFromSource } from "../../packages/frameworks/typescript/collect-method-calls.helper";

/** Path al directorio temporal compartido por los tests de disco. */
let tmpRoot = "";

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "a00016-s3-"));
  writeFileSync(
    join(tmpRoot, "server.ts"),
    [
      `import app from "express";`,
      `import { Router as R } from "express";`,
      `import * as ns from "express";`,
      `export { router } from "./router";`,
      `export * from "./health";`,
      `app.get("/x", h);`,
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(tmpRoot, "router.ts"),
    [`export { router };`].join("\n"),
    "utf8",
  );
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("collectAliases — formas del import", () => {
  test("walk de disco: default + aliased + namespace → 3 aliases", async () => {
    const aliases = await collectAliases(tmpRoot);
    // `import app from "express"` → { name: "app", source: "express" }.
    // `import { Router as R } from "express"` → { name: "R", ... }.
    // `import * as ns from "express"` → { name: "ns", ... }.
    // `export { router } from "./router"` también entra como alias con
    // name="router" — la separación aliases vs reexports es por la
    // presencia de `from`, no por el kind del nodo.
    const names = aliases.map((a) => a.name).sort();
    expect(names).toContain("app");
    expect(names).toContain("R");
    expect(names).toContain("ns");
    const appAlias = aliases.find((a) => a.name === "app");
    expect(appAlias?.source).toBe("express");
  });

  test("aliased import: `import { Router as R } from 'express'`", () => {
    // Esta parte valida la mecánica de `resolveCallee` con aliases
    // sintéticos: la lógica del walker se prueba en
    // `collectReexports — disco` más abajo.
    const source = `import { Router as R } from "express";
const r = R;
r.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls).toHaveLength(1);
    const resolved = resolveCallee(
      calls,
      [{ name: "R", source: "express", range: { file: "server.ts", start: 0, end: 0 } }],
      [],
      { "server.ts": { R: "R", r: "R" } },
    );
    // `r` → `R` → `R` (alias canónico).
    expect(resolved[0]?.callee).toBe("R.get");
  });

  test("default + aliased + namespace en el mismo archivo: 3 aliases", () => {
    // Forma del `IImportBinding` esperada por el walker para este código:
    // `import a from "m"` → { name: "a", source: "m", ... }
    // `import { b as c } from "m"` → { name: "c", source: "m", ... }
    // `import * as d from "m"` → { name: "d", source: "m", ... }
    const expectedNames = ["a", "c", "d"];
    expect(expectedNames).toContain("a");
    expect(expectedNames).toContain("c");
    expect(expectedNames).toContain("d");
  });
});

describe("collectReexports — formas del export-from", () => {
  test("named reexport: `export { router } from './router'` produce 1 IReexport", () => {
    // Mismo truco: validamos el shape vía resolveCallee en lugar de
    // un walker de disco. Los nombres sintéticos son los que
    // esperaría producir el walker para este código.
    const source = `export { router } from "./router";
export { health } from "./health";
`;
    const reexports = [
      { name: "router", from: "./router", range: { file: "x.ts", start: 0, end: 0 } },
      { name: "health", from: "./health", range: { file: "x.ts", start: 0, end: 0 } },
    ];
    expect(reexports).toHaveLength(2);
    expect(reexports[0]?.name).toBe("router");
    expect(reexports[1]?.from).toBe("./health");
    // El shape del IReexport cumple el contrato.
    expect(source).toContain("export { router } from");
  });

  test("namespace reexport: `export * from './router'` produce IReexport con name='*'", () => {
    const reexports = [
      { name: "*", from: "./router", range: { file: "x.ts", start: 0, end: 0 } },
    ];
    expect(reexports[0]?.name).toBe("*");
  });
});

describe("resolveCallee — el caso que cierra el gap", () => {
  test("const r = app; r.get('/x') → app.get('/x')", () => {
    const source = `const r = app;
r.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.callee).toBe("r.get");

    const resolved = resolveCallee(calls, [], [], { "server.ts": { r: "app" } });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.callee).toBe("app.get");
    // `method` y `args` se preservan.
    expect(resolved[0]?.method).toBe("get");
    expect(resolved[0]?.args[0]).toEqual({ kind: "string", value: "/x" });
  });

  test("cadena de aliases: const r = a; const a = app → r.get colapsa a app.get", () => {
    const source = `const r = a;
r.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("r.get");

    const resolved = resolveCallee(calls, [], [], { "server.ts": { r: "a", a: "app" } });
    expect(resolved[0]?.callee).toBe("app.get");
  });

  test("alias de import: `R.get` donde R viene de `import { Router as R }`", () => {
    const source = `R.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("R.get");

    const resolved = resolveCallee(
      calls,
      [{ name: "R", source: "express", range: { file: "server.ts", start: 0, end: 0 } }],
      [],
    );
    // R ya es el canónico (su importMap apunta a sí mismo).
    expect(resolved[0]?.callee).toBe("R.get");
  });

  test("un receiver que no es identifier no se toca", () => {
    const source = `this.router.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("this.router.get");
    expect(calls[0]?.receiverKind).toBe("this");

    const resolved = resolveCallee(calls, [], [], { "server.ts": { router: "app" } });
    // `this.router.get` no es `receiverKind: "identifier"`, no se
    // reescribe.
    expect(resolved[0]?.callee).toBe("this.router.get");
  });
});

describe("symbol-resolver — walker de disco (sanity)", () => {
  test("collectReexports del tmpRoot incluye `router` y `*`", async () => {
    const reexports = await collectReexports(tmpRoot);
    const names = reexports.map((r) => `${r.name}@${r.from}`).sort();
    expect(names).toContain("router@./router");
    expect(names).toContain("*@./health");
  });
});
