/**
 * Integration tests for `buildSummaryToolRegistration`.
 *
 * The context and the handler capturer come from
 * `tests/helpers/plugin-context.ts`: they are the same ones the
 * other specs use, and the workspace is built with the core's real
 * factory so the double cannot drift from the contract.
 */
import { describe, expect, test } from "vitest";

import { buildSummaryToolRegistration } from "../../src/lib/tools/summary.tool";
import { captureHandler, makeContext, workspaceRoot } from "../helpers/plugin-context";

/** Root of the tanit project (not the plugin's). */
const TANIT_EXPORTER_ROOT = workspaceRoot(import.meta.url);

const makeCtx = (options: Record<string, unknown> = {}) =>
  makeContext({ workspaceRoot: TANIT_EXPORTER_ROOT, options });

describe("tanit_summary", () => {
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

  test("resolves defaultProjectRoot relative to the plugin's workspace", async () => {
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

  test("returns the same result on consecutive calls (cache reset)", async () => {
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
