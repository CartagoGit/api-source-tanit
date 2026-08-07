/**
 * Tool `expostman_test`.
 *
 * Corre la batería de tests del propio proyecto export-to-postman y
 * (opcionalmente) un smoke test contra un fixture de un framework
 * concreto. Devuelve un informe estructurado con duración y exit
 * code de cada step, pensado para que un agente MCP pueda actuar
 * sobre fallos sin re-correr nada.
 *
 * Steps ejecutados (en orden, con timeout individual):
 *   1. `bun run typecheck`  (a menos que `withTypecheck === false`).
 *   2. Smoke in-process por framework (si `framework` está dado):
 *      carga el scanner correspondiente + el fixture en
 *      `tests/smoke-fixtures/<framework>-mini/`, corre el `scan()`,
 *      y diffea contra el `expected.json` hermano.
 *   3. `bun test tests/e2e/`  — siempre.
 *
 * SOLID:
 *   - S: solo orquesta invocaciones + parseo de output.
 *   - L: prefiere `runBunCommand` sobre `Bun.spawn` directo.
 *   - D: usa opciones del plugin (workspace, scripts) inyectadas.
 *
 * Forma canónica `IToolRegistration`.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@mcp-vertex/core/public";

import {
  TestInputSchema,
  type ITestOutput,
  type ITestStep,
} from "../contracts/plugin.interface";
import { normalizeCwd, runBunCommand } from "../helpers/runner.helper";
import { runSmoke } from "../helpers/smoke-runner.helper";
import {
  SUPPORTED_FRAMEWORKS,
  scannerBundleFor,
} from "../../../../../frameworks/framework.registry";

const TOOL_ID = "test";

/**
 * Raíz del mini-fixture de un framework. La convención es estable:
 * `tests/smoke-fixtures/<framework>-mini/`.
 */
function smokeFixtureRoot(workspaceRoot: string, framework: string): string {
  return `${workspaceRoot}/tests/smoke-fixtures/${framework}-mini`;
}

/** Resultado compacto de un smoke: cuántas rutas casaron, o por qué no. */
type SmokeOutcome =
  | { ok: true; routeCount: number }
  | { ok: false; detail: string };

/**
 * Corre el smoke de un framework contra su mini-fixture.
 *
 * Los colaboradores salen del registry (`scannerBundleFor`), que es la
 * única fuente de verdad sobre qué frameworks existen.
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
 * Igual que `smokeFramework` pero devuelve los argumentos de `pushStep`,
 * para el caso de un único framework pedido explícitamente.
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
 * Devuelve un fragmento útil del stderr o stdout de un test que falló:
 * las últimas N líneas que contienen palabras clave (`fail`, `error`,
 * `error:`) para que un agente tenga contexto sin tener que re-correr.
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
 * Formatea el diff del smoke-runner como un detalle legible.
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
      "Corre los tests del proyecto export-to-postman y (opcionalmente) un smoke test por framework. " +
      "Devuelve un informe estructurado (ok + steps con duración y exit code) que un agente puede actuar sin re-correr.",
    tags: ["postman", "test", "ci"],
    effects: ["spawn"],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Corre `bun run typecheck` (opcional) y `bun test tests/e2e/` del propio proyecto export-to-postman. " +
            "Si pasas `framework`, añade un smoke test in-process contra el fixture correspondiente en " +
            "`tests/smoke-fixtures/<framework>-mini/` (más rápido que los e2e comprehensives). " +
            "Devuelve `{ ok, steps, durationMs, framework }` con un detalle por step listo para actuar.",
          inputSchema: TestInputSchema,
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

            for (const framework of SUPPORTED_FRAMEWORKS) {
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

          const ok = steps.every((s) => s.ok);
          const out: ITestOutput = {
            ok,
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
