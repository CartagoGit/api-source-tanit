/**
 * Branch coverage for summary's pure text/history/error paths.
 *
 * The existing CLI tests exercise summary through real projects. These
 * cases isolate the branches in the text formatter and history append.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { main as summaryMain } from "../../packages/cli/commands/summary.script";
import { summarizeWithAllFrameworks } from "../../packages/frameworks/index.js";
import { appendHistory } from "../../packages/ui/server/history.service.js";

vi.mock("../../packages/frameworks/index.js", () => ({
  summarizeWithAllFrameworks: vi.fn(),
}));

vi.mock("../../packages/ui/server/history.service.js", () => ({
  appendHistory: vi.fn(),
}));

const savedArgv = process.argv;

afterEach(() => {
  process.argv = savedArgv;
  vi.mocked(summarizeWithAllFrameworks).mockReset();
  vi.mocked(appendHistory).mockReset();
});

function withArgv<T>(args: ReadonlyArray<string>, fn: () => Promise<T>): Promise<T> {
  const saved = [...process.argv];
  try {
    process.argv = ["node", "summary-gap-branches.spec.ts", ...args];
    return fn();
  } finally {
    process.argv = saved;
  }
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    framework: "express",
    frameworks: ["express", "graphql"],
    projectName: "summary-project",
    baseUrl: "http://localhost",
    routesInCode: 3,
    withFormRequest: 2,
    withoutFormRequest: 1,
    bodiesAdded: 1,
    queriesAdded: 1,
    inferredVariables: 2,
    manualEndpoints: 0,
    auth: { loginEndpoint: "POST /login" },
    zeroConfig: false,
    configPath: "/tmp/summary/config.constant.ts",
    warnings: ["one warning"],
    evidence: [{ weight: -1, signal: "legacy", artifact: "" }],
    health: {
      withValidationPercent: 80,
      withBodySchemaPercent: 75,
      withExamplesPercent: 70,
      withDescriptionPercent: 65,
    },
    ...overrides,
  } as never;
}

describe("summary text and history branches", () => {
  test("prints hybrid, non-auth, non-zero-config and negative-evidence lines", async () => {
    vi.mocked(summarizeWithAllFrameworks).mockResolvedValue(summary({ auth: null }));
    vi.mocked(appendHistory).mockResolvedValue({ ok: true, path: "/tmp/summary/history.jsonl" });
    const logs: string[] = [];
    const savedLog = console.log;
    console.log = (...values: ReadonlyArray<unknown>) => logs.push(values.map(String).join(" "));
    try {
      expect(await withArgv(["--project-root", "/tmp/summary", "--no-history"], () => summaryMain())).toBe(0);
    } finally {
      console.log = savedLog;
    }
    expect(logs.join("\n")).toContain("híbrido: express, graphql");
    expect(logs.join("\n")).toContain("not detected");
    expect(logs.join("\n")).toContain("Zero-config:");
    expect(logs.join("\n")).toContain("no");
    expect(logs.join("\n")).toContain("legacy");
  });

  test("warns when appending history fails", async () => {
    vi.mocked(summarizeWithAllFrameworks).mockResolvedValue(summary());
    vi.mocked(appendHistory).mockResolvedValue({
      ok: false,
      path: "/tmp/summary/history.jsonl",
      reason: "disk full",
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await withArgv(["--project-root", "/tmp/summary"], () => summaryMain())).toBe(0);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    } finally {
      warning.mockRestore();
    }
  });

  test("returns code 1 for a non-Error thrown by discovery", async () => {
    vi.mocked(summarizeWithAllFrameworks).mockRejectedValue("not an Error");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await withArgv(["--project-root", "/tmp/summary", "--no-history"], () => summaryMain())).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("not an Error"));
    } finally {
      error.mockRestore();
    }
  });
});
