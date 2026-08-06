import { describe, expect, test } from "vitest";

import { buildSummaryToolRegistration } from "../../src/lib/tools/summary.tool";
import type { IMcpPluginContext } from "@mcp-vertex/core/public";

function makeCtx(opts: Partial<IMcpPluginContext> = {}): IMcpPluginContext {
  return {
    workspace: "file://" + process.cwd() + "/",
    namespacePrefix: "postman-exporter",
    options: {},
    ...opts,
  };
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function captureHandler(
  registration: ReturnType<typeof buildSummaryToolRegistration>,
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
  void registration.register(server as never);
  if (!captured) throw new Error("tool handler not registered");
  return captured;
}

describe("postman-exporter_summary", () => {
  test("registra el tool con id='summary' y effects=[]", () => {
    const reg = buildSummaryToolRegistration(makeCtx());
    expect(reg.id).toBe("summary");
    expect(reg.effects).toEqual([]);
    expect(typeof reg.register).toBe("function");
  });

  test("rechaza input inválido", async () => {
    const reg = buildSummaryToolRegistration(makeCtx());
    const handler = captureHandler(reg);
    const result = await handler({ projectRoot: 123 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Input inválido/i);
  });

  test("devuelve error si projectRoot no existe", async () => {
    const reg = buildSummaryToolRegistration(makeCtx());
    const handler = captureHandler(reg);
    const result = await handler({
      projectRoot: "/tmp/__no_existe_zzzz__",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no existe/);
  });

  test("devuelve campos estructurados para un fixture Django", async () => {
    const reg = buildSummaryToolRegistration(makeCtx());
    const handler = captureHandler(reg);
    const result = await handler({
      projectRoot: process.cwd() + "/tests/smoke-fixtures/django-mini",
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

  test("devuelve el mismo resultado en llamadas consecutivas (cache reset)", async () => {
    const reg = buildSummaryToolRegistration(makeCtx());
    const handler = captureHandler(reg);
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
