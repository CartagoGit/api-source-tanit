/**
 * De dónde sale la raíz del proyecto, con una sola respuesta.
 *
 * Tres comandos la resolvían de tres formas distintas, y la de `push`
 * ni siquiera leía `--project-root`: pasárselo no hacía nada. Ninguna
 * decía **de dónde** había salido, y eso importa porque el último
 * recurso es el directorio actual — `watch` lanzado desde `/tmp`
 * recorrió el árbol y generó la colección de un proyecto suelto entre
 * los temporales, sin decir una palabra.
 */
import { describe, expect, test } from "vitest";
import { resolve } from "node:path";

import { guessedRootNotice, resolveRoot } from "../../packages/core/helpers/resolve-root.helper";

const SIN_ENV: Record<string, string | undefined> = {};

describe("de dónde sale la raíz", () => {
  test("`--project-root` gana", () => {
    const r = resolveRoot({
      argv: ["--project-root", "/proyectos/api"],
      env: { POSTMAN_PROJECT_ROOT: "/otro" },
      cwd: "/cwd",
    });
    expect(r.root).toBe(resolve("/proyectos/api"));
    expect(r.origin).toBe("flag");
  });

  test("sin flag, manda la variable de entorno", () => {
    const r = resolveRoot({
      argv: [],
      env: { POSTMAN_PROJECT_ROOT: "/del/entorno" },
      cwd: "/cwd",
    });
    expect(r.root).toBe(resolve("/del/entorno"));
    expect(r.origin).toBe("env");
  });

  test("sin nada, el directorio actual", () => {
    const r = resolveRoot({ argv: [], env: SIN_ENV, cwd: "/cwd" });
    expect(r.root).toBe(resolve("/cwd"));
    expect(r.origin).toBe("cwd");
  });

  test("una variable vacía no cuenta como elegida", () => {
    const r = resolveRoot({ argv: [], env: { POSTMAN_PROJECT_ROOT: "" }, cwd: "/cwd" });
    expect(r.origin).toBe("cwd");
  });

  test("siempre devuelve una ruta absoluta", () => {
    expect(resolveRoot({ argv: ["--project-root", "./api"], env: SIN_ENV }).root).toMatch(
      /^\//,
    );
  });

  test("acepta `--project-root=valor`, que ninguna de las tres copias soportaba", () => {
    const r = resolveRoot({ argv: ["--project-root=/pegado"], env: SIN_ENV });
    expect(r.root).toBe(resolve("/pegado"));
    expect(r.origin).toBe("flag");
  });
});

describe("saber si se ha adivinado", () => {
  test.for([
    [["--project-root", "/x"], true],
    [[], false],
  ] as const)("argv %j → explicit=%s", ([argv, esperado]) => {
    expect(resolveRoot({ argv: [...argv], env: SIN_ENV, cwd: "/c" }).explicit).toBe(
      esperado,
    );
  });

  /**
   * El aviso solo aparece cuando se ha adivinado. Si saliera siempre,
   * sería ruido y dejaría de leerse justo el día que importa.
   */
  test("no avisa cuando la raíz la eligió alguien", () => {
    expect(
      guessedRootNotice(resolveRoot({ argv: ["--project-root", "/x"], env: SIN_ENV })),
    ).toBe("");
    expect(
      guessedRootNotice(resolveRoot({ argv: [], env: { POSTMAN_PROJECT_ROOT: "/x" } })),
    ).toBe("");
  });

  test("avisa, dice cuál usa y cómo cambiarla", () => {
    const aviso = guessedRootNotice(resolveRoot({ argv: [], env: SIN_ENV, cwd: "/tmp" }));
    expect(aviso).toContain("/tmp");
    expect(aviso).toContain("--project-root");
  });
});
