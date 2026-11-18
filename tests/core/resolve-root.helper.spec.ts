/**
 * Where the project root comes from, with a single answer.
 *
 * Three commands resolved it in three different ways, and `push` did
 * not even read `--project-root`: passing it did nothing. None of them
 * said **where** the root came from, and that matters because the
 * last-resort source is the current directory — `watch` launched from
 * `/tmp` walked the tree and generated a stray project's collection
 * among the temporaries, without saying a word.
 */
import { describe, expect, test } from "vitest";
import { resolve } from "node:path";

import { guessedRootNotice, resolveRoot } from "../../packages/core/helpers/resolve-root.helper";

const SIN_ENV: Record<string, string | undefined> = {};

describe("where the root comes from", () => {
  test("`--project-root` wins", () => {
    const r = resolveRoot({
      argv: ["--project-root", "/proyectos/api"],
      env: { POSTMAN_PROJECT_ROOT: "/otro" },
      cwd: "/cwd",
    });
    expect(r.root).toBe(resolve("/proyectos/api"));
    expect(r.origin).toBe("flag");
  });

  test("without a flag, the environment variable wins", () => {
    const r = resolveRoot({
      argv: [],
      env: { POSTMAN_PROJECT_ROOT: "/del/entorno" },
      cwd: "/cwd",
    });
    expect(r.root).toBe(resolve("/del/entorno"));
    expect(r.origin).toBe("env");
  });

  test("with nothing, the current directory", () => {
    const r = resolveRoot({ argv: [], env: SIN_ENV, cwd: "/cwd" });
    expect(r.root).toBe(resolve("/cwd"));
    expect(r.origin).toBe("cwd");
  });

  test("an empty variable does not count as chosen", () => {
    const r = resolveRoot({ argv: [], env: { POSTMAN_PROJECT_ROOT: "" }, cwd: "/cwd" });
    expect(r.origin).toBe("cwd");
  });

  test("always returns an absolute path", () => {
    expect(resolveRoot({ argv: ["--project-root", "./api"], env: SIN_ENV }).root).toMatch(
      /^\//,
    );
  });

  test("accepts `--project-root=value`, which none of the three copies supported", () => {
    const r = resolveRoot({ argv: ["--project-root=/pegado"], env: SIN_ENV });
    expect(r.root).toBe(resolve("/pegado"));
    expect(r.origin).toBe("flag");
  });
});

describe("knowing whether it was guessed", () => {
  test.for([
    [["--project-root", "/x"], true],
    [[], false],
  ] as const)("argv %j → explicit=%s", ([argv, esperado]) => {
    expect(resolveRoot({ argv: [...argv], env: SIN_ENV, cwd: "/c" }).explicit).toBe(
      esperado,
    );
  });

  /**
   * The notice only shows up when the root was guessed. If it showed
   * up every time, it would become noise and stop being read on the
   * day it actually matters.
   */
  test("does not warn when someone chose the root", () => {
    expect(
      guessedRootNotice(resolveRoot({ argv: ["--project-root", "/x"], env: SIN_ENV })),
    ).toBe("");
    expect(
      guessedRootNotice(resolveRoot({ argv: [], env: { POSTMAN_PROJECT_ROOT: "/x" } })),
    ).toBe("");
  });

  test("warns, says which one is used and how to change it", () => {
    const aviso = guessedRootNotice(resolveRoot({ argv: [], env: SIN_ENV, cwd: "/tmp" }));
    expect(aviso).toContain("/tmp");
    expect(aviso).toContain("--project-root");
  });
});
