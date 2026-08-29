/**
 * Integration tests de `buildSummaryToolRegistration`.
 *
 * El contexto y el capturador de handlers salen de
 * `tests/helpers/plugin-context.ts`: son los mismos que usan los otros
 * specs, y el workspace se construye con la fábrica real del core para
 * que el doble no pueda separarse del contrato.
 */
import { describe, expect, test } from "vitest";

import { buildSummaryToolRegistration } from "../../src/lib/tools/summary.tool";
import { captureHandler, makeContext, workspaceRoot } from "../helpers/plugin-context";

/** Raíz del proyecto export-to-postman (no la del plugin). */
const POSTMAN_EXPORTER_ROOT = workspaceRoot(import.meta.url);

const makeCtx = (options: Record<string, unknown> = {}) =>
  makeContext({ workspaceRoot: POSTMAN_EXPORTER_ROOT, options });

describe("expostman_summary", () => {
  test("registra el tool con id='summary' y effects=[]", () => {
    const reg = buildSummaryToolRegistration(makeCtx());
    expect(reg.id).toBe("summary");
    expect(reg.effects).toEqual([]);
    expect(typeof reg.register).toBe("function");
  });

  test("rechaza input inválido", async () => {
    const reg = buildSummaryToolRegistration(makeCtx());
    const handler = await captureHandler(reg);
    const result = await handler({ projectRoot: 123 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Input inválido/i);
  });

  test("devuelve error si projectRoot no existe", async () => {
    const reg = buildSummaryToolRegistration(makeCtx());
    const handler = await captureHandler(reg);
    const result = await handler({
      projectRoot: "/tmp/__no_existe_zzzz__",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no existe/);
  });

  test("devuelve campos estructurados para un fixture Django", async () => {
    const reg = buildSummaryToolRegistration(makeCtx());
    const handler = await captureHandler(reg);
    const result = await handler({
      projectRoot: "tests/smoke-fixtures/django-mini",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
      ok: boolean;
      framework: string;
      routesInCode: number;
      zeroConfig: boolean;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.framework).toBe("django");
    expect(parsed.routesInCode).toBe(4);
    expect(parsed.zeroConfig).toBe(true);
  });

  test("resuelve defaultProjectRoot relativo al workspace del plugin", async () => {
    const reg = buildSummaryToolRegistration(
      makeCtx({ defaultProjectRoot: "tests/smoke-fixtures/django-mini" }),
    );
    const handler = await captureHandler(reg);
    const result = await handler({});
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
      ok: boolean;
      framework: string;
      configPath: string;
    };

    expect(result.isError).toBeFalsy();
    expect(parsed.ok).toBe(true);
    expect(parsed.framework).toBe("django");
    expect(parsed.configPath).toBe("<zero-config>");
  });

  test("devuelve el mismo resultado en llamadas consecutivas (cache reset)", async () => {
    const reg = buildSummaryToolRegistration(makeCtx());
    const handler = await captureHandler(reg);
    const r1 = await handler({
      projectRoot: process.cwd() + "/tests/smoke-fixtures/django-mini",
    });
    const r2 = await handler({
      projectRoot: process.cwd() + "/tests/smoke-fixtures/express-mini",
    });
    const p1 = JSON.parse(r1.content[0]?.text ?? "{}") as { framework: string };
    const p2 = JSON.parse(r2.content[0]?.text ?? "{}") as { framework: string };
    expect(p1.framework).toBe("django");
    expect(p2.framework).toBe("express");
  });
});
