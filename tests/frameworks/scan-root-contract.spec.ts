/**
 * Contrato de `effectiveScanRoot` / `safeScanRoot` — a00012 S1.b.
 *
 * El helper centraliza lo que Hono, NestJS y Next.js ya hacían inline:
 * resolver la raíz efectiva de escaneo a partir de
 * `match.frameworkSearchRoot`, y devolver `match.projectRoot` cuando
 * ese campo está ausente. La diferencia con los inline es la guarda
 * de contención: un `frameworkSearchRoot` con `..` no debe poder
 * sacar al scanner del `projectRoot`.
 *
 * Los cuatro casos cubren el contrato entero:
 *
 *   1. Ausente (null/undefined/cadena vacía) → `projectRoot`.
 *   2. Relativo dentro del raíz → unión resuelta.
 *   3. Escape (`..` que sale de la raíz) → `Error` con contexto.
 *
 * El cuarto caso (cadena vacía) no estaba en la propuesta original,
 * pero es una de las tres formas que el helper trata como "ausente":
 * un caller que reciba un valor vacío del CLI no debe acabar con una
 * resolución a `projectRoot + ""` (= `projectRoot`), que es lo
 * correcto, pero también es la única diferencia observable entre
 * `""` y `undefined`, y conviene fijarla.
 *
 * `tsconfig.base.json` tiene `allowImportingTsExtensions: false`, por
 * lo que el import va sin la extensión `.ts` (mismo patrón que el
 * resto de `tests/frameworks/*.spec.ts`).
 */
import { describe, expect, test } from "vitest";

import {
  effectiveScanRoot,
  safeScanRoot,
} from "../../packages/core/discovery/scan-root.helper";

function matchWith(
  frameworkSearchRoot: string | null | undefined,
  projectRoot = "/tmp/mono",
  framework = "fastify",
): Parameters<typeof effectiveScanRoot>[0] {
  // El helper sólo lee `projectRoot`, `frameworkSearchRoot` y
  // `framework` del match. Construir un objeto ad-hoc mantiene el
  // test libre de la forma completa de `IProjectMatch`, que no
  // aporta nada al contrato que se prueba aquí.
  const match = {
    framework,
    projectRoot,
    artifacts: [] as ReadonlyArray<string>,
  };
  // `IProjectMatch.frameworkSearchRoot` está tipado como
  // `string | undefined` (no `null`); el helper sí trata `null` como
  // ausente por simetría con los call sites reales (CLI / plugin),
  // pero el contrato del tipo no incluye `null`. Normalizamos aquí
  // para que el test hable el mismo idioma que la interfaz.
  if (frameworkSearchRoot === undefined || frameworkSearchRoot === null) {
    return match;
  }
  return { ...match, frameworkSearchRoot };
}

describe("effectiveScanRoot", () => {
  test("frameworkSearchRoot ausente → projectRoot (sin tocar)", () => {
    const projectRoot = "/tmp/mono";
    expect(effectiveScanRoot(matchWith(undefined, projectRoot))).toBe(
      projectRoot,
    );
    expect(effectiveScanRoot(matchWith(null, projectRoot))).toBe(projectRoot);
  });

  test("frameworkSearchRoot = 'apps/api' → /tmp/mono/apps/api", () => {
    expect(effectiveScanRoot(matchWith("apps/api"))).toBe("/tmp/mono/apps/api");
  });

  test("frameworkSearchRoot = '' → projectRoot (cadena vacía ≡ ausente)", () => {
    const projectRoot = "/tmp/mono";
    expect(effectiveScanRoot(matchWith("", projectRoot))).toBe(projectRoot);
  });

  test("frameworkSearchRoot = '../escape' → lanza con contexto del match", () => {
    const projectRoot = "/tmp/mono";
    const framework = "fastify";
    expect(() =>
      effectiveScanRoot(matchWith("../escape", projectRoot, framework)),
    ).toThrowError(/frameworkSearchRoot inválido[\s\S]*fastify[\s\S]*\/tmp\/mono/);
  });
});

describe("safeScanRoot (alias de effectiveScanRoot)", () => {
  test("mismo comportamiento con valor presente: 'apps/api'", () => {
    expect(safeScanRoot(matchWith("apps/api"))).toBe("/tmp/mono/apps/api");
  });

  test("mismo comportamiento con valor ausente: projectRoot", () => {
    const projectRoot = "/tmp/mono";
    expect(safeScanRoot(matchWith(undefined, projectRoot))).toBe(projectRoot);
  });

  test("mismo comportamiento con escape: lanza", () => {
    expect(() => safeScanRoot(matchWith("../escape"))).toThrowError(
      /frameworkSearchRoot inválido/,
    );
  });
});
