/**
 * Tool `postman-exporter_test`.
 *
 * Corre la batería de tests del propio proyecto postman-exporter y
 * (opcionalmente) un smoke test contra un fixture de un framework
 * concreto. Devuelve un informe estructurado con duración y exit code
 * de cada step, pensado para que un agente MCP pueda actuar sobre
 * fallos sin re-correr nada.
 *
 * Steps ejecutados (en orden, con timeout individual):
 *   1. `bun run typecheck`  (a menos que `withTypecheck === false`)
 *   2. `bun test tests/e2e/<framework>-comprehensive.test.ts`
 *      — si `framework` está dado y existe ese fixture.
 *   3. `bun test tests/e2e/`  — siempre.
 *
 * SOLID:
 *   - S: solo orquesta invocaciones + parseo de output.
 *   - L: prefiere `runBunScript` sobre `Bun.spawn` directo.
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
} from "../contract/postman-exporter.interface";
import { runBunCommand } from "../helpers/runner.helper";

const TOOL_ID = "test";

/** Map framework → nombre del archivo de test correspondiente. */
const FRAMEWORK_TO_FIXTURE: Record<string, string> = {
  laravel: "laravel",
  symfony: "symfony",
  express: "express",
  fastapi: "fastapi",
  nestjs: "nestjs",
  django: "django",
  openapi: "openapi",
  flask: "flask",
  nextjs: "nextjs",
  gin: "gin",
  springboot: "springboot",
  aspnet: "aspnet",
};

/**
 * Parsea la salida de `bun test` para extraer el conteo de tests
 * pasados/fallidos y el resumen final. Tolerante a cambios menores
 * de formato.
 */
function parseTestSummary(stdout: string): string | undefined {
  // Formato: "Ran N tests across M files. [Xms]"
  const ranMatch = stdout.match(/Ran\s+(\d+)\s+tests?\s+across\s+(\d+)\s+files?/i);
  const passMatch = stdout.match(/(\d+)\s+pass/i);
  const failMatch = stdout.match(/(\d+)\s+fail/i);
  if (!ranMatch && !passMatch && !failMatch) return undefined;
  const parts: string[] = [];
  if (passMatch) parts.push(`${passMatch[1]} pass`);
  if (failMatch && Number(failMatch[1]) > 0) parts.push(`${failMatch[1]} fail`);
  if (ranMatch) parts.push(`of ${ranMatch[1]} tests in ${ranMatch[2]} files`);
  return parts.join(", ");
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
  // Buscar las primeras 5 líneas que contengan "fail" o "error".
  const keyLines = lines.filter(
    (l) =>
      /\bfail\b/i.test(l) ||
      /\berror\b/i.test(l) ||
      /expect\(/i.test(l),
  );
  const snippet = (keyLines.length > 0 ? keyLines : lines.slice(-8)).slice(0, 8);
  return snippet.join("\n").trim() || undefined;
}

export function buildTestToolRegistration(
  ctx: IMcpPluginContext,
): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Corre los tests del proyecto postman-exporter y (opcionalmente) un smoke test por framework. " +
      "Devuelve un informe estructurado (ok + steps con duración y exit code) que un agente puede actuar sin re-correr.",
    tags: ["postman", "test", "ci", "spawn"],
    effects: ["spawn"],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Corre `bun run typecheck` (opcional) y `bun test tests/e2e/` del propio proyecto postman-exporter. " +
            "Si pasas `framework`, añade un smoke test contra el fixture correspondiente. " +
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
          const workspaceRoot = ctx.workspace.toString();
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

          // Step 2: smoke test por framework (si se pide).
          if (args.framework) {
            const fixture = FRAMEWORK_TO_FIXTURE[args.framework];
            const testFile = `tests/e2e/${fixture}-comprehensive.test.ts`;
            const r = runBunCommand(["test", testFile], {
              cwd: workspaceRoot,
              timeoutMs: 60_000,
            });
            const summary = parseTestSummary(r.stdout);
            const detail = r.ok
              ? undefined
              : extractFailureDetail(r.stderr, r.stdout);
            pushStep(
              `smoke:${args.framework}`,
              r.ok,
              r.exitCode,
              r.durationMs,
              summary,
              detail,
            );
          }

          // Step 3: suite e2e completa (siempre).
          const r = runBunCommand(["test", "tests/e2e/"], {
            cwd: workspaceRoot,
            timeoutMs: 120_000,
          });
          const summary = parseTestSummary(r.stdout);
          const detail = r.ok
            ? undefined
            : extractFailureDetail(r.stderr, r.stdout);
          pushStep(
            "test:e2e",
            r.ok,
            r.exitCode,
            r.durationMs,
            summary,
            detail,
          );

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
