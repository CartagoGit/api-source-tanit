/**
 * Contrato de `effectiveProjectRoot` / `effectiveSearchRoot` /
 * `rawProjectRoot` — a00014 S1.
 *
 * El helper centraliza lo que Express, Hono, NestJS y Next.js ya
 * hacían inline: resolver la raíz efectiva del proyecto a partir de
 * `match.frameworkSearchRoot`, y devolver `match.projectRoot` cuando
 * ese campo está ausente. La diferencia con los inline es que
 * ningún scanner puede ignorar `frameworkSearchRoot` por accidente:
 * los 21 scanners consumen ahora esta primitiva, y la gate
 * `lint:effective-project-root` rechaza cualquier scanner que siga
 * leyendo `match.projectRoot` directamente.
 *
 * Los ocho tests cubren el contrato entero:
 *
 *   1. Ausente (null/undefined/cadena vacía) → `projectRoot`.
 *   2. Relativo dentro de la raíz → unión resuelta.
 *   3. Absoluto → verbatim (decisión del host, no del helper).
 *   4. Escape relativo (`..` que sale de la raíz) → `Error` con
 *      contexto.
 *   5. Idempotencia: dos llamadas seguidas devuelven el mismo valor.
 *   6. Trailing slash: `'apps/api/'` ≡ `'apps/api'`.
 *   7. Pureza: el objeto `match` original no se muta tras la llamada.
 *   8. Repetición con `effectiveSearchRoot` (alias): misma semántica.
 *
 * `tsconfig.base.json` tiene `allowImportingTsExtensions: false`, por
 * lo que el import va sin la extensión `.ts` (mismo patrón que el
 * resto de `tests/core/*.spec.ts`).
 */
import { describe, expect, test } from "vitest";

import {
  effectiveProjectRoot,
  effectiveSearchRoot,
  rawProjectRoot,
} from "../../packages/core/discovery/effective-project-root.helper";

function matchWith(
  frameworkSearchRoot: string | null | undefined,
  projectRoot = "/tmp/mono",
  framework = "fastify",
): Parameters<typeof effectiveProjectRoot>[0] {
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

describe("effectiveProjectRoot", () => {
  test("frameworkSearchRoot ausente → projectRoot (sin tocar)", () => {
    const projectRoot = "/tmp/mono";
    expect(effectiveProjectRoot(matchWith(undefined, projectRoot))).toBe(
      projectRoot,
    );
    expect(effectiveProjectRoot(matchWith(null, projectRoot))).toBe(
      projectRoot,
    );
  });

  test("frameworkSearchRoot = 'apps/api' → /tmp/mono/apps/api", () => {
    expect(effectiveProjectRoot(matchWith("apps/api"))).toBe(
      "/tmp/mono/apps/api",
    );
  });

  test("frameworkSearchRoot absoluto → verbatim (decisión del host)", () => {
    const abs = "/srv/shared/openapi.yaml";
    expect(effectiveProjectRoot(matchWith(abs))).toBe(abs);
  });

  test("frameworkSearchRoot = '' → projectRoot (cadena vacía ≡ ausente)", () => {
    const projectRoot = "/tmp/mono";
    expect(effectiveProjectRoot(matchWith("", projectRoot))).toBe(projectRoot);
  });

  test("frameworkSearchRoot = '../escape' → lanza con contexto del match", () => {
    const projectRoot = "/tmp/mono";
    const framework = "fastify";
    expect(() =>
      effectiveProjectRoot(matchWith("../escape", projectRoot, framework)),
    ).toThrowError(
      /frameworkSearchRoot inválido[\s\S]*fastify[\s\S]*\/tmp\/mono/,
    );
  });

  test("idempotente: dos llamadas seguidas devuelven el mismo valor", () => {
    const match = matchWith("apps/api");
    const first = effectiveProjectRoot(match);
    const second = effectiveProjectRoot(match);
    expect(second).toBe(first);
  });

  test("trailing slash: 'apps/api/' ≡ 'apps/api' (path.resolve normaliza)", () => {
    expect(effectiveProjectRoot(matchWith("apps/api/"))).toBe(
      "/tmp/mono/apps/api",
    );
  });

  test("puro: no muta el match original", () => {
    const match = matchWith("apps/api");
    const before = { ...match };
    effectiveProjectRoot(match);
    expect(match).toEqual(before);
  });
});

describe("effectiveSearchRoot (alias de effectiveProjectRoot)", () => {
  test("mismo comportamiento con valor presente: 'apps/api'", () => {
    expect(effectiveSearchRoot(matchWith("apps/api"))).toBe(
      "/tmp/mono/apps/api",
    );
  });

  test("mismo comportamiento con valor absoluto: verbatim", () => {
    const abs = "/srv/shared/openapi.yaml";
    expect(effectiveSearchRoot(matchWith(abs))).toBe(abs);
  });

  test("mismo comportamiento con escape: lanza", () => {
    expect(() => effectiveSearchRoot(matchWith("../escape"))).toThrowError(
      /frameworkSearchRoot inválido/,
    );
  });
});

describe("rawProjectRoot (escape hatch para projectRoot literal)", () => {
  test("devuelve match.projectRoot tal cual, sin tocar frameworkSearchRoot", () => {
    const projectRoot = "/tmp/mono";
    expect(rawProjectRoot(matchWith("apps/api", projectRoot))).toBe(projectRoot);
    expect(rawProjectRoot(matchWith(undefined, projectRoot))).toBe(projectRoot);
  });

  test("ignora frameworkSearchRoot aunque sea absoluto", () => {
    const projectRoot = "/tmp/mono";
    expect(rawProjectRoot(matchWith("/srv/shared", projectRoot))).toBe(
      projectRoot,
    );
  });
});
