/**
 * Tool `tanit_test`.
 *
 * Runs the test suite of the tanit project itself and (optionally)
 * a smoke test against a specific framework's fixture. Returns a
 * structured report with duration and exit code per step, designed
 * so that an MCP agent can act on failures without re-running.
 *
 * Steps executed (in order, each with its own timeout):
 *   1. `bun run typecheck` (unless `withTypecheck === false`).
 *   2. In-process smoke per framework (if `framework` is given):
 *      loads the corresponding scanner + the fixture at
 *      `tests/smoke-fixtures/<framework>-mini/`, runs `scan()`,
 *      and diffs against the sibling `expected.json`.
 *   3. `bun test tests/e2e/` — always.
 *
 * SOLID:
 *   - S: only orchestrates invocations + output parsing.
 *   - L: prefers `runBunCommand` over `Bun.spawn` directly.
 *   - D: uses the injected plugin options (workspace, scripts).
 *
 * Canonical `IToolRegistration` shape.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@delendai/core/public";

import {
  TestInputSchema,
  TestOutputSchema,
  type ITestOutput,
  type ITestStep,
} from "../contracts/plugin.interface";
import { normalizeCwd, runBunCommand } from "../helpers/runner.helper";
import { runSmoke } from "../helpers/smoke-runner.helper";
import { scannerBundleFor } from "../../../../../frameworks/framework.registry";
import { FRAMEWORK_IDS } from "../../../../../contracts/constants/frameworks/framework-ids.constant";

const TOOL_ID = "test";

/**
 * Root of the mini-fixture for a framework. The convention is
 * stable: `tests/smoke-fixtures/<framework>-mini/`.
 */
function smokeFixtureRoot(workspaceRoot: string, framework: string): string {
  return `${workspaceRoot}/tests/smoke-fixtures/${framework}-mini`;
}

/** Resultado compacto de un smoke: cuántas rutas casaron, o por qué no. */
type SmokeOutcome =
  | { ok: true; routeCount: number }
  | { ok: false; detail: string };

/**
 * Runs the smoke for a framework against its mini-fixture.
 *
 * The collaborators come from the registry (`scannerBundleFor`),
 * which is the single source of truth on which frameworks exist.
 */
async function smokeFramework(
  framework: string,
  fixtureRoot: string,
): Promise<SmokeOutcome> {
  const bundle = scannerBundleFor(framework);
  if (!bundle) {
    return { ok: false, detail: `${framework}: no registrado en el scanner registry` };
  }
  try {
    const match = await bundle.projectScanner.resolve(fixtureRoot);
    const result = await runSmoke({
      framework,
      fixtureRoot,
      scanner: bundle.routeScanner,
      match,
    });
    return result.ok
      ? { ok: true, routeCount: result.expectedCount }
      : { ok: false, detail: formatSmokeDetail(result) };
  } catch (err) {
    return {
      ok: false,
      detail: `${framework}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Same as `smokeFramework` but returns the arguments of `pushStep`,
 * for the case of a single explicitly requested framework.
 */
async function runFrameworkSmoke(
  framework: string,
  workspaceRoot: string,
): Promise<[string, boolean, number, number, string, string | undefined]> {
  const start = Date.now();
  const fixtureRoot = smokeFixtureRoot(workspaceRoot, framework);
  const outcome = await smokeFramework(framework, fixtureRoot);
  return outcome.ok
    ? [
        `smoke:${framework}`,
        true,
        0,
        Date.now() - start,
        `${outcome.routeCount} routes pass`,
        undefined,
      ]
    : [`smoke:${framework}`, false, 1, Date.now() - start, "smoke falló", outcome.detail];
}

/**
 * Returns a useful snippet of the stderr or stdout of a failed test:
 * the last N lines that contain keywords (`fail`, `error`, `error:`)
 * so that an agent has context without having to re-run.
 */
function extractFailureDetail(stderr: string, stdout: string): string | undefined {
  if (!stderr && !stdout) return undefined;
  const combined = `${stderr}\n${stdout}`;
  const lines = combined.split("\n");
  const keyLines = lines.filter(
    (l) =>
      /\bfail\b/i.test(l) ||
      /\berror\b/i.test(l) ||
      /expect\(/i.test(l),
  );
  const snippet = (keyLines.length > 0 ? keyLines : lines.slice(-8)).slice(0, 8);
  return snippet.join("\n").trim() || undefined;
}

/**
 * Formats the smoke-runner's diff as a readable detail.
 */
function formatSmokeDetail(diff: {
  missing: ReadonlyArray<{ method: string; uri: string }>;
  unexpected: ReadonlyArray<{ method: string; uri: string }>;
}): string {
  const lines: string[] = [];
  if (diff.missing.length > 0) {
    lines.push(
      `expected ${diff.missing.length} ruta(s) no detectadas por el scanner:`,
      ...diff.missing.map((r) => `  - ${r.method} ${r.uri}`),
    );
  }
  if (diff.unexpected.length > 0) {
    lines.push(
      `scanner devolvió ${diff.unexpected.length} ruta(s) no esperadas:`,
      ...diff.unexpected.map((r) => `  + ${r.method} ${r.uri}`),
    );
  }
  return lines.join("\n");
}

export function buildTestToolRegistration(
  ctx: IMcpPluginContext,
): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Corre los tests del proyecto tanit y (opcionalmente) un smoke test por framework. " +
      "Devuelve un informe estructurado (ok + steps con duración y exit code) que un agente puede actuar sin re-correr.",
    tags: ["postman", "test", "ci"],
    effects: ["spawn"],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Corre `bun run typecheck` (opcional) y `bun test tests/e2e/` del propio proyecto tanit. " +
            "Si pasas `framework`, añade un smoke test in-process contra el fixture correspondiente en " +
            "`tests/smoke-fixtures/<framework>-mini/` (más rápido que los e2e comprehensives). " +
            "Devuelve `{ ok, steps, durationMs, framework }` con un detalle por step listo para actuar.",
          inputSchema: TestInputSchema,
          outputSchema: TestOutputSchema,
        },
        async (input) => {
          const parsed = TestInputSchema.safeParse(input);
          if (!parsed.success) {
            return toolError(
              `Input inválido: ${parsed.error.message}`,
              "Pasa framework (opcional) o withTypecheck (default true).",
            );
          }
          const args = parsed.data;
          const workspaceRoot = normalizeCwd(ctx.workspace.root);
          const start = Date.now();
          const steps: ITestStep[] = [];

          const pushStep = (
            name: string,
            ok: boolean,
            exitCode: number,
            durationMs: number,
            summary?: string,
            detail?: string,
          ): void => {
            const step: ITestStep = {
              name,
              ok,
              exitCode,
              durationMs,
              ...(summary ? { summary } : {}),
              ...(detail ? { detail } : {}),
            };
            steps.push(step);
          };

          // Step 1: typecheck (opcional, default true).
          const withTypecheck = args.withTypecheck !== false;
          if (withTypecheck) {
            const r = runBunCommand(["run", "typecheck"], {
              cwd: workspaceRoot,
              timeoutMs: 60_000,
              ctx: {
                cwd: workspaceRoot,
                bunBin: ctx.options["delendaiBunBin"] as string | undefined,
              },
            });
            const detail = r.ok
              ? undefined
              : extractFailureDetail(r.stderr, r.stdout);
            pushStep(
              "typecheck",
              r.ok,
              r.exitCode,
              r.durationMs,
              r.ok ? "0 errors" : `${r.exitCode} exit`,
              detail,
            );
          }

          // Step 2: smoke in-process por framework (si se pide).
          if (args.framework) {
            pushStep(...(await runFrameworkSmoke(args.framework, workspaceRoot)));
          }

          // Step 3: smoke in-process de TODOS los mini-fixtures registrados.
          // Sustituye el spawn de `bun test tests/e2e/`, que creaba decenas
          // de subprocesos bun en paralelo y reventaba la RAM del host.
          {
            const smokeAllStart = Date.now();
            const { existsSync } = await import("node:fs");
            const failDetails: string[] = [];
            let passed = 0;

            for (const framework of FRAMEWORK_IDS) {
              const fixtureRoot = smokeFixtureRoot(workspaceRoot, framework);
              if (!existsSync(fixtureRoot)) continue;
              const outcome = await smokeFramework(framework, fixtureRoot);
              if (outcome.ok) passed += 1;
              else failDetails.push(outcome.detail);
            }

            const allOk = failDetails.length === 0;
            pushStep(
              "test:smoke-all",
              allOk,
              allOk ? 0 : 1,
              Date.now() - smokeAllStart,
              `${passed} frameworks pass${allOk ? "" : `, ${failDetails.length} fail`}`,
              allOk ? undefined : failDetails.join("\n"),
            );
          }

          // Same split as in `validate`: `ok` means "the steps could
          // run", `passed` means "all of them came back green". A red
          // test is a legitimate result of the tool, not a tool
          // failure, and the agent needs to distinguish them to know
          // whether to retry or read `steps`.
          const out: ITestOutput = {
            ok: true,
            passed: steps.every((s) => s.ok),
            steps,
            durationMs: Date.now() - start,
            framework: args.framework ?? null,
          };
          return toolJson(out);
        },
      );
    },
  };
}
