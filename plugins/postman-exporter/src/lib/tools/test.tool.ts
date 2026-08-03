/**
 * Tool `postman-exporter_test`.
 *
 * Corre la batería de tests del propio proyecto postman-exporter y
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
} from "../contract/postman-exporter.interface";
import { normalizeCwd, runBunCommand } from "../helpers/runner.helper";
import { runSmoke } from "../helpers/smoke-runner.helper";

const TOOL_ID = "test";

/** Map framework → nombre base del fixture en `tests/smoke-fixtures/`. */
const FRAMEWORK_TO_SMOKE_FIXTURE: Record<string, string> = {
  laravel: "laravel-mini",
  symfony: "symfony-mini",
  express: "express-mini",
  fastapi: "fastapi-mini",
  nestjs: "nestjs-mini",
  django: "django-mini",
  openapi: "openapi-mini",
  flask: "flask-mini",
  nextjs: "nextjs-mini",
  gin: "gin-mini",
  springboot: "springboot-mini",
  aspnet: "aspnet-mini",
};

/**
 * Carga dinámicamente el par (projectScanner, routeScanner) para un
 * framework. Cada scanner exporta sus propias clases siguiendo la
 * convención `<Framework>ProjectScanner` y `<Framework>Scanner` (o
 * `<Framework>RouteScanner` para los frameworks donde el scanner de
 * rutas tiene un nombre más específico, e.g. Django).
 *
 * Devuelve `null` si el framework no tiene scanners exportados o si
 * la convención no se cumple (e.g. fixture no implementado todavía).
 */
async function loadScannerPair(
  framework: string,
): Promise<null | {
  projectScanner: {
    resolve(projectRoot: string): Promise<{ projectRoot: string; framework: string }>;
  };
  routeScanner: {
    scan(match: { projectRoot: string }): Promise<ReadonlyArray<unknown>>;
  };
}> {
  const cap = framework[0]?.toUpperCase() + framework.slice(1);
  const projectName = `${cap}ProjectScanner`;
  const routeCandidates = [`${cap}Scanner`, `${cap}RouteScanner`];
  try {
    const mod = (await import(
      `../../../../../../service/scanners/${framework}.scanner`
    )) as Record<string, unknown>;
    const projectScanner = mod[projectName];
    let routeScanner: unknown = null;
    for (const candidate of routeCandidates) {
      if (mod[candidate]) {
        routeScanner = mod[candidate];
        break;
      }
    }
    if (!projectScanner || !routeScanner) return null;
    return {
      projectScanner: projectScanner as never,
      routeScanner: routeScanner as never,
    };
  } catch {
    return null;
  }
}

/**
 * Parsea la salida de `bun test` para extraer el conteo de tests
 * pasados/fallidos y el resumen final. Tolerante a cambios menores
 * de formato.
 */
function parseTestSummary(stdout: string): string | undefined {
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
          const workspaceRoot = normalizeCwd(ctx.workspace.toString());
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
            const smokeStart = Date.now();
            const fixtureName = FRAMEWORK_TO_SMOKE_FIXTURE[args.framework];
            if (!fixtureName) {
              pushStep(
                `smoke:${args.framework}`,
                false,
                1,
                Date.now() - smokeStart,
                "framework no soportado",
                `framework "${args.framework}" no está en FRAMEWORK_TO_SMOKE_FIXTURE`,
              );
            } else {
              const fixtureRoot = `${workspaceRoot}/tests/smoke-fixtures/${fixtureName}`;
              const scannerPair = await loadScannerPair(args.framework);
              if (!scannerPair) {
                pushStep(
                  `smoke:${args.framework}`,
                  false,
                  1,
                  Date.now() - smokeStart,
                  "scanner no disponible",
                  `no se encontró el módulo service/scanners/${args.framework}.scanner o sus clases ProjectScanner/Scanner`,
                );
              } else {
                try {
                  const match = await scannerPair.projectScanner.resolve(
                    fixtureRoot,
                  );
                  const result = await runSmoke({
                    framework: args.framework,
                    fixtureRoot,
                    scanner: scannerPair.routeScanner,
                    match,
                  });
                  const summary = result.ok
                    ? `${result.expectedCount} routes match`
                    : `missing=${result.missing.length} unexpected=${result.unexpected.length}`;
                  const detail = result.ok
                    ? undefined
                    : formatSmokeDetail(result);
                  pushStep(
                    `smoke:${args.framework}`,
                    result.ok,
                    result.ok ? 0 : 1,
                    result.durationMs,
                    summary,
                    detail,
                  );
                } catch (err) {
                  pushStep(
                    `smoke:${args.framework}`,
                    false,
                    1,
                    Date.now() - smokeStart,
                    "smoke crashed",
                    err instanceof Error ? err.message : String(err),
                  );
                }
              }
            }
          }

          // Step 3: suite e2e completa (siempre).
          const r = runBunCommand(["test", "tests/e2e/"], {
            cwd: workspaceRoot,
            timeoutMs: 120_000,
          });
          const summary = parseTestSummary(r.stderr || r.stdout);
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
