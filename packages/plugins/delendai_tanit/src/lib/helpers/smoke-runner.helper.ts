/**
 * `smoke-runner` helper.
 *
 * Runs the requested framework's scanner against a mini-fixture and
 * diffs the output against the sibling `expected.json`. This makes
 * the plugin the single source of truth for "is the scanner for
 * framework X still working?" — without having to run the
 * orchestrator or generate a complete collection.
 *
 * `expected.json` format:
 *   {
 *     "framework": "django",
 *     "routes": [
 *       { "method": "GET", "uri": "/api/users/" },
 *       ...
 *     ]
 *   }
 *
 * The diff compares sorted `(method, uri)` pairs. If the fixture's
 * and the scanner's URIs differ (e.g. Django with `<int:id>` vs
 * FastAPI with `{id}`), the user can adjust `expected.json` to
 * reflect the scanner's actual behaviour and lock down future
 * regressions.
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

/** Stable key for diffing (method+uri). */
function key(r: { method: string; uri: string }): string {
  return `${r.method.toUpperCase()}\t${r.uri}`;
}

/**
 * Loads the `expected.json` from the fixture root. Throws if it does
 * not exist or cannot be parsed.
 */
/**
 * Narrows a `Record<string, unknown>` down to `IExpectedFixture`,
 * validating the required fields. Replaces the `as IExpectedFixture`
 * that silently swallowed invalid manifests: if the `expected.json`
 * does not have the right shape, the smoke-runner says so with an
 * actionable message.
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
  // The final narrowing is legitimate: the predicate already
  // validated the shape.
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
 * Compares the scanner's routes against the `expected.json` and
 * returns the missing/unexpected diff.
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
 * Main API: runs the smoke-runner for a framework.
 *
 * `scanner` is an already-built `IRouteScanner`; `match` is the
 * resolved `IProjectMatch` (usually by an `IProjectScanner`).
 *
 * `fixtureRoot` is the path to the mini-fixture (where the sibling
 * `expected.json` lives).
 */
export async function runSmoke(opts: {
  framework: string;
  fixtureRoot: string;
  scanner: { scan(match: { projectRoot: string }): Promise<{ routes: ReadonlyArray<ParsedRoute> }> };
  match: { projectRoot: string };
}): Promise<ISmokeResult> {
  const start = Date.now();
  const expected = await loadExpected(opts.fixtureRoot);
  const result = await opts.scanner.scan(opts.match);
  const actual = result.routes;
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
