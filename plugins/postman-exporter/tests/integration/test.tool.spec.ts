/**
 * Integration tests para `buildTestToolRegistration`.
 *
 * Estrategia: mockeamos `IMcpPluginContext` con el workspace del
 * postman-exporter y registramos el tool en un server MCP simulado.
 * Después invocamos el handler directamente para verificar el output
 * sin necesidad del host MCP-vertex completo.
 *
 * Lo que probamos:
 *   - Schema rechaza inputs inválidos.
 *   - Suite e2e verde: `ok=true`, todos los steps en verde.
 *   - Smoke por framework: agrega un step con `name=smoke:<framework>`.
 *   - Forzar fallo: con `withTypecheck=false` y un fixture inexistente,
 *     el step devuelve `ok=false` con un `detail` útil para actuar.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { buildTestToolRegistration } from "../../src/lib/tools/test.tool";
import type { IMcpPluginContext } from "@mcp-vertex/core/public";

// Workspace del proyecto postman-exporter (no del plugin). El tool corre
// `bun test tests/e2e/` desde ese cwd.
const POSTMAN_EXPORTER_ROOT = resolve(__dirname, "../../../..");

function makeCtx(overrides: Partial<IMcpPluginContext> = {}): IMcpPluginContext {
  return {
    workspace: new URL(`file://${POSTMAN_EXPORTER_ROOT}/`),
    namespacePrefix: "postman-exporter",
    options: {},
    ...overrides,
  } as IMcpPluginContext;
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Mock del server MCP: solo necesitamos `registerTool(name, schema, handler)`.
 * Devuelve el handler para invocarlo en tests.
 */
function captureHandler(
  registration: ReturnType<typeof buildTestToolRegistration>,
): (
  input: unknown,
) => Promise<ToolCallResult> {
  let captured: ((input: unknown) => Promise<ToolCallResult>) | null = null;
  const server = {
    registerTool: (
      _name: string,
      _config: { description: string; inputSchema: unknown },
      handler: (input: unknown) => Promise<ToolCallResult>,
    ) => {
      captured = handler;
    },
  };
  // El `register` retorna { tools: [...] } pero aquí solo necesitamos
  // el side-effect del `server.registerTool`.
  void registration.register(server as never);
  if (!captured) throw new Error("tool handler not registered");
  return captured;
}

describe("postman-exporter_test", () => {
  test("registra el tool con id='test' y effects=['spawn']", () => {
    const reg = buildTestToolRegistration(makeCtx());
    expect(reg.id).toBe("test");
    expect(reg.effects).toContain("spawn");
    expect(typeof reg.register).toBe("function");
  });

  test("rechaza input inválido (framework no soportado)", async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const handler = captureHandler(reg);
    const result = await handler({ framework: "ruby-on-rails" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Input inválido/i);
  });

  test("corre la suite e2e y devuelve ok=true", { timeout: 30_000 }, async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const handler = captureHandler(reg);
    const result = await handler({ withTypecheck: false });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
      ok: boolean;
      steps: Array<{ name: string; ok: boolean; summary?: string }>;
      durationMs: number;
      framework: string | null;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.framework).toBeNull();
    // Sin typecheck, NO debe aparecer el step typecheck.
    const names = parsed.steps.map((s) => s.name);
    expect(names).not.toContain("typecheck");
    expect(names).toContain("test:e2e");
    const e2eStep = parsed.steps.find((s) => s.name === "test:e2e");
    expect(e2eStep?.ok).toBe(true);
    // El summary debe mencionar el conteo de tests.
    expect(e2eStep?.summary).toMatch(/\d+ pass/);
    expect(parsed.durationMs).toBeGreaterThan(0);
  });

  test("incluye typecheck por defecto", { timeout: 30_000 }, async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const handler = captureHandler(reg);
    const result = await handler({});
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
      steps: Array<{ name: string; ok: boolean }>;
    };
    const names = parsed.steps.map((s) => s.name);
    expect(names).toContain("typecheck");
  });

  test("agrega un step smoke:<framework> cuando se pide", { timeout: 30_000 }, async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const handler = captureHandler(reg);
    const result = await handler({
      framework: "django",
      withTypecheck: false,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
      ok: boolean;
      steps: Array<{ name: string; ok: boolean; summary?: string }>;
      framework: string | null;
    };
    expect(parsed.framework).toBe("django");
    const smokeStep = parsed.steps.find((s) => s.name === "smoke:django");
    expect(smokeStep).toBeDefined();
    expect(smokeStep?.ok).toBe(true);
    expect(smokeStep?.summary).toMatch(/\d+ routes pass/);
  });

  test("devuelve detalle cuando un step falla (framework inexistente vía archivo)", async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const handler = captureHandler(reg);
    // Forzamos un framework con un archivo de test que no existe.
    // `nestjs` SÍ existe; usamos uno inventado vía `framework` inválido
    // que pase el zod pero no encuentre fixture: trampa no posible vía
    // schema. Probamos un escenario de fallo con `withTypecheck` y un
    // workspace vacío apuntando a una ruta inválida → typecheck fallará.
    const badCtx = makeCtx({
      workspace: new URL("file:///tmp/no-such-workspace-12345/"),
    });
    const reg2 = buildTestToolRegistration(badCtx);
    const handler2 = captureHandler(reg2);
    const result = await handler2({ withTypecheck: true });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
      ok: boolean;
      steps: Array<{ name: string; ok: boolean; detail?: string }>;
    };
    expect(parsed.ok).toBe(false);
    // El step typecheck debe haber fallado y tener detalle.
    const typecheckStep = parsed.steps.find((s) => s.name === "typecheck");
    expect(typecheckStep).toBeDefined();
    expect(typecheckStep?.ok).toBe(false);
    expect(typecheckStep?.detail).toBeDefined();
  });
});
