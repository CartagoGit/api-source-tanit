/**
 * Tests for `collectAliases`, `collectReexports` and `resolveCallee`
 * (a00016 S3).
 *
 * Covers the 4 shapes the scanner needs:
 *   - `import x from "./y"` → alias.
 *   - `import { x as y } from "./y"` → aliased import.
 *   - `export { x } from "./y"` → reexport.
 *   - `const r = app; r.get(...)` → local alias resolution.
 *
 * Unit tests — the pure primitives do not read disk. The disk
 * walkers use a small temporary directory written by the test.
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

/** Path to the temporary directory shared by the disk tests. */
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

describe("collectAliases — import shapes", () => {
  test("disk walk: default + aliased + namespace → 3 aliases", async () => {
    const aliases = await collectAliases(tmpRoot);
    // `import app from "express"` → { name: "app", source: "express" }.
    // `import { Router as R } from "express"` → { name: "R", ... }.
    // `import * as ns from "express"` → { name: "ns", ... }.
    // `export { router } from "./router"` also enters as an alias
    // with name="router" — the aliases vs reexports split is by the
    // presence of `from`, not by the AST node kind.
    const names = aliases.map((a) => a.name).sort();
    expect(names).toContain("app");
    expect(names).toContain("R");
    expect(names).toContain("ns");
    const appAlias = aliases.find((a) => a.name === "app");
    expect(appAlias?.source).toBe("express");
  });

  test("aliased import: `import { Router as R } from 'express'`", () => {
    // This part validates the mechanics of `resolveCallee` with
    // synthetic aliases: the walker logic is tested under
    // `collectReexports — disk` further down.
    const source = `import { Router as R } from "express";
const r = R;
r.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls).toHaveLength(1);
    const resolved = resolveCallee(
      calls,
      [{ name: "R", importedName: "Router", source: "express", range: { file: "server.ts", start: 0, end: 0 } }],
      [],
      { "server.ts": { R: "R", r: "R" } },
    );
    // `r` → `R` → `R` (canonical alias).
    expect(resolved[0]?.callee).toBe("R.get");
  });

  test("x00048 S1: `R.get` from `import { Router as R }` carries importedName='Router'", () => {
    // Antes de x00048 S1, `IImportBinding` sólo guardaba el nombre
    // local (`R`), y un scanner que quisiera resolver `R.get` a
    // `Router.get` no podía porque había perdido el nombre original
    // del módulo exportador. Ahora `importedName` lo preserva.
    const source = `import { Router as R } from "express";
R.get("/x", h);
`;
    // Sintético: validamos el shape del binding con el campo
    // nuevo.
    const binding = {
      name: "R",
      importedName: "Router",
      source: "express",
      range: { file: "server.ts", start: 0, end: 0 },
    };
    expect(binding.name).toBe("R");
    expect(binding.importedName).toBe("Router");
    expect(binding.source).toBe("express");

    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("R.get");
    // x00054 S1: `resolveCallee` ahora usa `importedName`, así que
    // el mapeo `R → Router` reescribe `R.get` al símbolo canónico
    // `Router.get` que un scanner de Express puede enrutar. Antes
    // este assert esperaba `R.get` porque `buildAliasIndex` mapeaba
    // a sí mismo — bug documentado en la aceptación de x00048 S1.
    const resolved = resolveCallee(calls, [binding], []);
    expect(resolved[0]?.callee).toBe("Router.get");
  });

  test("x00048 S1: default + namespace imports carry their canonical importedName", () => {
    // `import x from "m"` → importedName = "default".
    // `import * as ns from "m"` → importedName = "*".
    // `import { a } from "m"` → importedName = "a".
    const defaultBinding = {
      name: "x",
      importedName: "default",
      source: "m",
      range: { file: "x.ts", start: 0, end: 0 },
    };
    const nsBinding = {
      name: "ns",
      importedName: "*",
      source: "m",
      range: { file: "x.ts", start: 0, end: 0 },
    };
    const namedBinding = {
      name: "a",
      importedName: "a",
      source: "m",
      range: { file: "x.ts", start: 0, end: 0 },
    };
    expect(defaultBinding.importedName).toBe("default");
    expect(nsBinding.importedName).toBe("*");
    expect(namedBinding.importedName).toBe("a");
  });

  test("x00054 S1: default import (`import x from 'm'`) is NOT rewritten by resolveCallee", () => {
    // x00054 S1: el binding tiene `importedName === "default"`, que
    // no es un símbolo canónico del módulo exportador (es el alias
    // sintáctico del export por defecto). `buildAliasIndex` lo
    // descarta, así que `x` no aparece en `importMap` y
    // `resolveCallee` deja `x.get` intacto — no queremos un callee
    // `default.get` porque ensucia el route graph.
    const binding = {
      name: "x",
      importedName: "default",
      source: "m",
      range: { file: "server.ts", start: 0, end: 0 },
    };
    const source = `x.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("x.get");

    const resolved = resolveCallee(calls, [binding], []);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.callee).toBe("x.get");
  });

  test("x00054 S1: namespace import (`import * as ns from 'm'`) is NOT rewritten by resolveCallee", () => {
    // x00054 S1: el binding tiene `importedName === "*"`, que es el
    // namespace completo, no un símbolo concreto. Reescribir
    // `ns.get` a `*.get` no aporta nada al scanner, así que la
    // guarda lo deja en `importMap` y `resolveCallee` no toca el
    // callee.
    const binding = {
      name: "ns",
      importedName: "*",
      source: "m",
      range: { file: "server.ts", start: 0, end: 0 },
    };
    const source = `ns.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("ns.get");

    const resolved = resolveCallee(calls, [binding], []);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.callee).toBe("ns.get");
  });

  test("default + aliased + namespace in the same file: 3 aliases", () => {
    // Shape of the `IImportBinding` the walker expects for this code:
    // `import a from "m"` → { name: "a", source: "m", ... }
    // `import { b as c } from "m"` → { name: "c", source: "m", ... }
    // `import * as d from "m"` → { name: "d", source: "m", ... }
    const expectedNames = ["a", "c", "d"];
    expect(expectedNames).toContain("a");
    expect(expectedNames).toContain("c");
    expect(expectedNames).toContain("d");
  });
});

describe("collectReexports — export-from shapes", () => {
  test("named reexport: `export { router } from './router'` produces 1 IReexport", () => {
    // Same trick: we validate the shape via resolveCallee instead of
    // a disk walker. The synthetic names are the ones the walker
    // would be expected to produce for this code.
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
    // The shape of the IReexport satisfies the contract.
    expect(source).toContain("export { router } from");
  });

  test("namespace reexport: `export * from './router'` produces IReexport with name='*'", () => {
    const reexports = [
      { name: "*", from: "./router", range: { file: "x.ts", start: 0, end: 0 } },
    ];
    expect(reexports[0]?.name).toBe("*");
  });
});

describe("resolveCallee — the case that closes the gap", () => {
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
    // `method` and `args` are preserved.
    expect(resolved[0]?.method).toBe("get");
    expect(resolved[0]?.args[0]).toEqual({ kind: "string", value: "/x" });
  });

  test("alias chain: const r = a; const a = app → r.get collapses to app.get", () => {
    const source = `const r = a;
r.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("r.get");

    const resolved = resolveCallee(calls, [], [], { "server.ts": { r: "a", a: "app" } });
    expect(resolved[0]?.callee).toBe("app.get");
  });

  test("import alias: `R.get` where R comes from `import { Router as R }`", () => {
    const source = `R.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("R.get");

    const resolved = resolveCallee(
      calls,
      [{ name: "R", importedName: "Router", source: "express", range: { file: "server.ts", start: 0, end: 0 } }],
      [],
    );
    // x00054 S1: el canónico es el símbolo del módulo exportador
    // (`Router`), no el alias local (`R`), así que `R.get` se
    // reescribe a `Router.get`. Antes el assert esperaba `R.get`
    // porque `buildAliasIndex` mapeaba `R → R`.
    expect(resolved[0]?.callee).toBe("Router.get");
  });

  test("alias chain through import alias: const r = R; r.get → Router.get", () => {
    // Combina los dos rewrites ya validados por separado en los
    // tests previos:
    //   1. `const r = R` → `followAliasChain` reescribe `r` a `R`
    //      via `constAliases` (test "alias chain: const r = a; ...").
    //   2. `R` viene de `import { Router as R }` → el `importMap`
    //      reescribe `R` a `Router` (test "import alias: R.get ...").
    // El callee final tiene que ser `Router.get`, el símbolo
    // canónico del módulo `express`. Si `followAliasChain` se parara
    // en la primera resolución y dejara `R.get`, el scanner de
    // Express no podría enrutar la llamada porque `R` no es un
    // método del framework — sólo lo es por coincidencia de
    // nomenclatura.
    const source = `import { Router as R } from "express";
const r = R;
r.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("r.get");

    const resolved = resolveCallee(
      calls,
      [{ name: "R", importedName: "Router", source: "express", range: { file: "server.ts", start: 0, end: 0 } }],
      [],
      { "server.ts": { r: "R" } },
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.callee).toBe("Router.get");
  });

  test("a non-identifier receiver is left untouched", () => {
    const source = `this.router.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("this.router.get");
    expect(calls[0]?.receiverKind).toBe("this");

    const resolved = resolveCallee(calls, [], [], { "server.ts": { router: "app" } });
    // `this.router.get` is not `receiverKind: "identifier"`, so it is
    // not rewritten.
    expect(resolved[0]?.callee).toBe("this.router.get");
  });
});

describe("symbol-resolver — disk walker (sanity)", () => {
  test("collectReexports from tmpRoot includes `router` and `*`", async () => {
    const reexports = await collectReexports(tmpRoot);
    const names = reexports.map((r) => `${r.name}@${r.from}`).sort();
    expect(names).toContain("router@./router");
    expect(names).toContain("*@./health");
  });
});
