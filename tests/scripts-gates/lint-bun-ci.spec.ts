import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  findBunxTools,
  findToolProblems,
  isCommentLine,
  parseJsonc,
  readToolFacts,
  type IBunxTool,
  type IToolFacts,
} from "../../scripts/gates/lint-bun-ci.script";
import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";

/** Facts de un repo en el que todo está bien. */
const SANA: IToolFacts = {
  declared: { typescript: "5.9.3", vitest: "4.1.11" },
  lockSpecs: { typescript: "5.9.3", vitest: "4.1.11" },
  lockResolved: { typescript: "5.9.3", vitest: "4.1.11" },
};

function tool(overrides: Partial<IBunxTool> = {}): IBunxTool {
  return {
    tool: "tsc",
    package: "typescript",
    file: "scripts/gates/typecheck.script.ts",
    line: 34,
    ...overrides,
  };
}

describe("lint:bun-ci — las herramientas que el repo invoca por su nombre", () => {
  test("el gate pasa en el repo", () => {
    const result = spawnSync("bun", ["run", "lint:bun-ci"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toContain("sin deriva");
    expect(result.status).toBe(0);
  });

  test("typescript está declarado con la versión exacta del lockfile", async () => {
    const facts = await readToolFacts();
    // Declarada: sin esto, `bunx tsc` se la baja del registro.
    expect(facts.declared.typescript).toBeDefined();
    // Exacta: un rango deja la respuesta del gate en manos del día.
    expect(facts.declared.typescript).not.toMatch(/^[\^~><=*x]/);
    // La misma que el lockfile: si no, `bun install --frozen-lockfile` falla.
    expect(facts.lockSpecs.typescript).toBe(facts.declared.typescript);
    expect(facts.lockResolved.typescript).toBe(facts.declared.typescript);
  });

  test("encuentra las herramientas que se invocan con bunx", () => {
    const tools = findBunxTools([
      { file: "scripts/gates/typecheck.script.ts", source: 'spawnSync("bunx", ["tsc", "--noEmit"])', kind: "code" },
      { file: "package.json (test)", source: '"bunx vitest run"', kind: "command" },
    ]);
    expect(tools.map((t) => `${t.tool}->${t.package}`).sort()).toEqual([
      "tsc->typescript",
      "vitest->vitest",
    ]);
  });

  test("una mención en prosa no es una invocación", () => {
    const tools = findBunxTools([
      { file: "scripts/gates/x.script.ts", source: 'const msg = "bunx lo bajaría del registro";', kind: "code" },
    ]);
    expect(tools).toHaveLength(0);
  });

  test("un comentario no es una invocación", () => {
    const tools = findBunxTools([
      { file: "scripts/gates/x.script.ts", source: '// spawnSync("bunx", ["tsc"])\n/* run("bunx", ["vitest"]) */', kind: "code" },
    ]);
    expect(tools).toHaveLength(0);
  });

  test("una herramienta sin mapear avisa, en vez de pasar en silencio", () => {
    const problems = findToolProblems([tool({ tool: "nueva", package: "" })], SANA);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("BINARY_TO_PACKAGE");
  });

  test("una herramienta sin declarar es un problema", () => {
    const problems = findToolProblems([tool()], { ...SANA, declared: {} });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("no está declarado");
  });

  test("una versión con rango es un problema", () => {
    const problems = findToolProblems([tool()], {
      ...SANA,
      declared: { ...SANA.declared, typescript: "^5.9.3" },
      lockSpecs: { ...SANA.lockSpecs, typescript: "^5.9.3" },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("debe ser exacta");
  });

  test("el lockfile desincronizado del package.json es un problema", () => {
    const problems = findToolProblems([tool()], {
      ...SANA,
      lockSpecs: { ...SANA.lockSpecs, typescript: "5.9.2" },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("frozen-lockfile");
  });

  test("una herramienta que el lockfile no resuelve es un problema", () => {
    const problems = findToolProblems([tool()], {
      ...SANA,
      lockResolved: {},
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.detail).toContain("no resuelve");
  });

  test("todo en orden no da problemas", () => {
    expect(findToolProblems([tool(), tool({ tool: "vitest", package: "vitest" })], SANA)).toHaveLength(0);
  });
});

describe("lint:bun-ci — el lockfile y sus comentarios", () => {
  test("parseJsonc lee un JSON con comas colgantes", () => {
    expect(parseJsonc('{"a": 1,}')).toEqual({ a: 1 });
    expect(parseJsonc('{"a": [1, 2,],}')).toEqual({ a: [1, 2] });
  });

  test("parseJsonc lee el bun.lock real", async () => {
    const raw = await readFile(join(REPO_ROOT, "bun.lock"), "utf8");
    const lock = parseJsonc(raw) as { packages?: Record<string, unknown[]> };
    expect(Object.keys(lock.packages ?? {}).length).toBeGreaterThan(0);
  });

  test("isCommentLine distingue el comentario del código", () => {
    expect(isCommentLine("//")).toBe(true);
    expect(isCommentLine("  * el caso")).toBe(true);
    expect(isCommentLine("/* el caso */")).toBe(true);
    expect(isCommentLine("const x = 1;")).toBe(false);
  });
});
