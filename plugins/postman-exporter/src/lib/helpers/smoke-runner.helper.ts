/**
 * Helper `smoke-runner`.
 *
 * Ejecuta el scanner del framework pedido contra un mini-fixture y
 * diffa el output contra un `expected.json` hermano. Esto convierte
 * al plugin en la única fuente de verdad para "¿el scanner del
 * framework X sigue funcionando?" — sin tener que ejecutar el
 * orquestador ni generar una collection completa.
 *
 * Formato de `expected.json`:
 *   {
 *     "framework": "django",
 *     "routes": [
 *       { "method": "GET", "uri": "/api/users/" },
 *       ...
 *     ]
 *   }
 *
 * El diff compara `(method, uri)` ordenados. Si las URIs del fixture
 * y del scanner difieren (e.g. Django con `<int:id>` vs FastAPI con
 * `{id}`), el usuario puede ajustar el `expected.json` para reflejar
 * el comportamiento real del scanner y bloquear regresiones futuras.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ParsedRoute } from "../../../../../../contract/scanner.interface";

/** Un endpoint esperado en el `expected.json`. */
export interface IExpectedRoute {
  readonly method: string;
  readonly uri: string;
}

/** Forma del `expected.json`. */
export interface IExpectedFixture {
  readonly framework: string;
  readonly routes: ReadonlyArray<IExpectedRoute>;
}

/** Resultado del smoke-runner. */
export interface ISmokeResult {
  readonly ok: boolean;
  readonly framework: string;
  readonly fixtureRoot: string;
  readonly actualCount: number;
  readonly expectedCount: number;
  /** Solo en rutas que están en `expected` pero NO en `actual`. */
  readonly missing: ReadonlyArray<IExpectedRoute>;
  /** Solo en rutas que están en `actual` pero NO en `expected`. */
  readonly unexpected: ReadonlyArray<{ readonly method: string; readonly uri: string }>;
  readonly durationMs: number;
}

/** Llave estable para diffing (method+uri). */
function key(r: { method: string; uri: string }): string {
  return `${r.method.toUpperCase()}\t${r.uri}`;
}

/**
 * Carga el `expected.json` desde la raíz del fixture. Lanza si no
 * existe o no se puede parsear.
 */
export async function loadExpected(fixtureRoot: string): Promise<IExpectedFixture> {
  const path = join(fixtureRoot, "expected.json");
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as IExpectedFixture;
  if (
    typeof parsed.framework !== "string" ||
    !Array.isArray(parsed.routes)
  ) {
    throw new Error(
      `expected.json inválido en ${fixtureRoot}: requiere { framework, routes[] }`,
    );
  }
  return parsed;
}

/**
 * Compara las rutas del scanner contra el `expected.json` y devuelve
 * un `ISmokeResult` con el diff.
 */
export function diffRoutes(
  actual: ReadonlyArray<ParsedRoute>,
  expected: ReadonlyArray<IExpectedRoute>,
): { missing: IExpectedRoute[]; unexpected: Array<{ method: string; uri: string }> } {
  const actualKeys = new Set(actual.map(key));
  const expectedKeys = new Set(expected.map(key));
  const missing = expected.filter((r) => !actualKeys.has(key(r)));
  const unexpected = actual
    .map((r) => ({ method: r.method, uri: r.uri }))
    .filter((r) => !expectedKeys.has(key(r)));
  return { missing, unexpected };
}

/**
 * API principal: corre el smoke-runner para un framework.
 *
 * `scanner` es un `IRouteScanner` ya construido; `match` es el
 * `IProjectMatch` resuelto (normalmente por un `IProjectScanner`).
 *
 * `fixtureRoot` es la ruta al mini-fixture (donde está `expected.json`).
 */
export async function runSmoke(opts: {
  framework: string;
  fixtureRoot: string;
  scanner: { scan(match: { projectRoot: string }): Promise<ReadonlyArray<ParsedRoute>> };
  match: { projectRoot: string };
}): Promise<ISmokeResult> {
  const start = Date.now();
  const expected = await loadExpected(opts.fixtureRoot);
  const actual = await opts.scanner.scan(opts.match);
  const { missing, unexpected } = diffRoutes(actual, expected.routes);
  return {
    ok: missing.length === 0 && unexpected.length === 0,
    framework: opts.framework,
    fixtureRoot: opts.fixtureRoot,
    actualCount: actual.length,
    expectedCount: expected.routes.length,
    missing,
    unexpected,
    durationMs: Date.now() - start,
  };
}
