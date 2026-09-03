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

import { isRecord, parseJson } from "../../../../../core/helpers/parse-json.helper";
import type { ParsedRoute } from "../../../../../contracts/interfaces/core/scanner.interface";
import type {
  IExpectedFixture,
  IExpectedRoute,
  ISmokeResult,
} from "../contracts/interfaces/runner.interface";

/** Llave estable para diffing (method+uri). */
function key(r: { method: string; uri: string }): string {
  return `${r.method.toUpperCase()}\t${r.uri}`;
}

/**
 * Carga el `expected.json` desde la raíz del fixture. Lanza si no
 * existe o no se puede parsear.
 */
/**
 * Estrecha un `Record<string, unknown>` a `IExpectedFixture`, validando
 * los campos obligatorios. Sustituye al `as IExpectedFixture` que
 * silenciaba manifestas inválidos: si el `expected.json` no tiene la
 * forma correcta, el smoke-runner lo dice con un mensaje accionable.
 */
function asExpectedFixture(
  value: Record<string, unknown>,
  source: string,
): IExpectedFixture {
  if (
    typeof value["framework"] !== "string" ||
    !Array.isArray(value["routes"])
  ) {
    throw new Error(
      `expected.json inválido en ${source}: requiere { framework: string, routes: array }`,
    );
  }
  // La estrechez final es legítima: el predicado ya validó la forma.
  return value as unknown as IExpectedFixture;
}

export async function loadExpected(fixtureRoot: string): Promise<IExpectedFixture> {
  const path = join(fixtureRoot, "expected.json");
  const raw = await readFile(path, "utf8");
  const result = parseJson(raw);
  if (!result.ok || !isRecord(result.value)) {
    throw new Error(
      `expected.json inválido en ${fixtureRoot}: ${result.ok ? "no es un objeto" : result.reason}`,
    );
  }
  return asExpectedFixture(result.value, fixtureRoot);
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
