/**
 * Integration tests for `buildTestToolRegistration`.
 *
 * Strategy: we mock `IMcpPluginContext` with the tanit project's
 * workspace and register the tool in a simulated MCP server.
 * Then we invoke the handler directly to verify the output without
 * needing the full delendai host.
 *
 * What we test:
 *   - Schema rejects invalid inputs.
 *   - E2e suite green: `ok=true`, all steps green.
 *   - Per-framework smoke: adds a step with `name=smoke:<framework>`.
 *   - Forcing a failure: with `withTypecheck=false` and a missing
 *     fixture, the step returns `ok=false` with a `detail` useful
 *     for acting on.
 */
import { describe, expect, test } from "vitest";

import { buildTestToolRegistration } from "../../src/lib/tools/test.tool";
import { captureHandler, makeContext, workspaceRoot } from "../helpers/plugin-context";

// Workspace of the tanit project (not the plugin's). The tool runs
// `bun test tests/e2e/` from that cwd.
const TANIT_EXPORTER_ROOT = workspaceRoot(import.meta.url);

const makeCtx = (options: Record<string, unknown> = {}) =>
  makeContext({ workspaceRoot: TANIT_EXPORTER_ROOT, options });

describe("tanit_test", () => {
  test("registra el tool con id='test' y effects=['spawn']", () => {
    const reg = buildTestToolRegistration(makeCtx());
    expect(reg.id).toBe("test");
    expect(reg.effects).toContain("spawn");
    expect(typeof reg.register).toBe("function");
  });

  test("rejects invalid input (unsupported framework)", async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const handler = await captureHandler(reg);
    const result = await handler({ framework: "ruby-on-rails" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Input inválido/i);
  });

  test("runs the smoke for every framework and returns ok=true", { timeout: 30_000 }, async () => {
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

  test("includes typecheck when requested", { timeout: 30_000 }, async () => {
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

  test("adds a step smoke:<framework> when requested", { timeout: 30_000 }, async () => {
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

  test("returns detail when a step fails (missing framework via file)", async () => {
    const reg = buildTestToolRegistration(makeCtx());
    const _handler = await captureHandler(reg);
    // We force a framework with a non-existent test file.
    // `nestjs` DOES exist; we use a made-up one via an invalid
    // `framework` that passes zod but finds no fixture: a trap not
    // possible via the schema. We probe a failure scenario with
    // `withTypecheck` and an empty workspace pointing at an invalid
    // path → typecheck will fail.
    const badCtx = makeContext({ workspaceRoot: "/tmp/no-such-workspace-12345" });
    const reg2 = buildTestToolRegistration(badCtx);
    const handler2 = await captureHandler(reg2);
    const result = await handler2({ withTypecheck: true });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
      ok: boolean;
      passed: boolean;
      steps: Array<{ name: string; ok: boolean; detail?: string }>;
    };
    // The two fields say different things, and before they were one:
    // `ok` means "the steps could run" and `passed` means "they came
    // back green". A red test is a legitimate result of the tool, not
    // a tool failure — which is why `ok` stays `true` here.
    expect(parsed.ok).toBe(true);
    expect(parsed.passed).toBe(false);
    // The typecheck step must have failed and carry a detail.
    const typecheckStep = parsed.steps.find((s) => s.name === "typecheck");
    expect(typecheckStep).toBeDefined();
    expect(typecheckStep?.ok).toBe(false);
    expect(typecheckStep?.detail).toBeDefined();
  });
});
