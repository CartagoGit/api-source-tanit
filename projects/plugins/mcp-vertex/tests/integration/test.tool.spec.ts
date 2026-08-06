/**
 * Integration tests para `buildTestToolRegistration`.
 *
 * Estrategia: mockeamos `IMcpPluginContext` con el workspace del
 * export-to-postman y registramos el tool en un server MCP simulado.
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
import { describe, expect, test } from "vitest";
import { resolve } from "node:path";

import { buildTestToolRegistration } from "../../src/lib/tools/test.tool";
import { captureHandler, makeContext, workspaceRoot } from "../helpers/plugin-context";

// Workspace del proyecto export-to-postman (no del plugin). El tool corre
// `bun test tests/e2e/` desde ese cwd.
const POSTMAN_EXPORTER_ROOT = workspaceRoot(import.meta.url);

const makeCtx = (options: Record<string, unknown> = {}) =>
  makeContext({ workspaceRoot: POSTMAN_EXPORTER_ROOT, options });

describe("expostman_test", () => {
  test("registra el tool con id='test' y effects=['spawn']", () => {
    const reg = buildTestToolRegistration(makeCtx());
    expect(reg.id).toBe("test");
    expect(reg.effects).toContain("spawn");
    expect(typeof reg.register).toBe("function");
  });

  test("rechaza input inválido (framework no soportado)", async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const handler = await captureHandler(reg);
    const result = await handler({ framework: "ruby-on-rails" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Input inválido/i);
  });

  test("corre el smoke de todos los frameworks y devuelve ok=true", { timeout: 30_000 }, async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const handler = await captureHandler(reg);
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
    const names = parsed.steps.map((s) => s.name);
    expect(names).not.toContain("typecheck");
    expect(names).toContain("test:smoke-all");
    const smokeAllStep = parsed.steps.find((s) => s.name === "test:smoke-all");
    expect(smokeAllStep?.ok).toBe(true);
    expect(smokeAllStep?.summary).toMatch(/\d+ frameworks pass/);
    expect(parsed.durationMs).toBeGreaterThan(0);
  });

  test("incluye typecheck cuando se pide", { timeout: 30_000 }, async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const handler = await captureHandler(reg);
    const result = await handler({ withTypecheck: true });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
      steps: Array<{ name: string; ok: boolean }>;
    };
    const names = parsed.steps.map((s) => s.name);
    expect(names).toContain("typecheck");
  });

  test("agrega un step smoke:<framework> cuando se pide", { timeout: 30_000 }, async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const handler = await captureHandler(reg);
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
    const handler = await captureHandler(reg);
    // Forzamos un framework con un archivo de test que no existe.
    // `nestjs` SÍ existe; usamos uno inventado vía `framework` inválido
    // que pase el zod pero no encuentre fixture: trampa no posible vía
    // schema. Probamos un escenario de fallo con `withTypecheck` y un
    // workspace vacío apuntando a una ruta inválida → typecheck fallará.
    const badCtx = makeContext({ workspaceRoot: "/tmp/no-such-workspace-12345" });
    const reg2 = buildTestToolRegistration(badCtx);
    const handler2 = await captureHandler(reg2);
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
