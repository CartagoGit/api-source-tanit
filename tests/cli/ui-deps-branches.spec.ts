import { describe, expect, test, vi } from "vitest";
import { startUiServer } from "../../packages/ui/server/ui-server.service.js";
import { seedLocales, loadLocales } from "../../packages/ui/i18n/i18n.service.js";
import { browseDirectory } from "../../packages/ui/server/browse.service.js";
import { planDryRun } from "../../packages/ui/server/dry-run.service.js";
import { readSettings, patchSettings } from "../../packages/ui/settings/settings.service.js";
import { readHistory } from "../../packages/ui/server/history.service.js";
import { generateWithAllFrameworks, summarizeWithAllFrameworks } from "../../packages/frameworks/index.js";
import { runGenerate } from "../../packages/cli/commands/generate.script.js";
import { main as uiMain } from "../../packages/cli/commands/ui.script";
import type { IGenerationResult } from "../../packages/contracts/interfaces/core/discovery.interface.js";
import type { IProjectSummary } from "../../packages/contracts/interfaces/core/domain.interface.js";
import type { IDryRunPlan } from "../../packages/contracts/interfaces/cli/dry-run.interface.js";
import type { IGenerateOutcome } from "../../packages/contracts/interfaces/cli/command-outcomes.interface.js";

vi.mock("../../packages/ui/server/ui-server.service.js", () => ({ startUiServer: vi.fn() }));
vi.mock("../../packages/ui/i18n/i18n.service.js", () => ({ seedLocales: vi.fn(), loadLocales: vi.fn() }));
vi.mock("../../packages/ui/server/browse.service.js", () => ({ browseDirectory: vi.fn() }));
vi.mock("../../packages/ui/server/dry-run.service.js", () => ({ planDryRun: vi.fn() }));
vi.mock("../../packages/ui/settings/settings.service.js", () => ({ readSettings: vi.fn(), patchSettings: vi.fn() }));
vi.mock("../../packages/ui/server/history.service.js", () => ({ readHistory: vi.fn() }));
vi.mock("../../packages/frameworks/index.js", () => ({
  generateWithAllFrameworks: vi.fn(),
  summarizeWithAllFrameworks: vi.fn(),
}));
vi.mock("../../packages/cli/commands/generate.script.js", () => ({ runGenerate: vi.fn() }));

const mock = vi.mocked;

describe("ui dependencies branch surface", () => {
  test("calls every dependency with optional args and records their results", async () => {
    mock(startUiServer).mockReturnValue({ url: "http://x", port: 1, stop: vi.fn() });
    mock(seedLocales).mockResolvedValue(undefined);
    mock(loadLocales).mockResolvedValue({ locales: [], rejected: [] });
    const generated: IGenerationResult = {
      config: {
        name: "p",
        collectionName: "p",
        collectionDescription: "",
        baseUrl: "http://localhost",
        variables: [],
        filePrefixes: {},
        zones: [],
        zoneOrder: [],
        defaultZone: "Other",
        authDescriptions: {},
        loginEndpointName: "Login",
        environments: [],
      },
      collection: { info: { name: "p", description: "", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, variable: [], item: [] },
      specs: [],
      match: { framework: "express", projectRoot: "/tmp", artifacts: [] },
      routes: [],
      metrics: { routes: 1, specs: 1, withValidation: 1, withoutValidation: 0, bodiesInferred: 0, queriesInferred: 0, responsesInferred: 0 },
      warnings: [],
      frameworks: ["express"],
      authFlow: null,
      origin: "scanner",
      authScheme: { type: "none", evidence: "test" },
      context: { projectRoot: "/tmp", packageRoot: "/tmp", projectBasename: "p", outputDir: "/tmp" },
      project: { zeroConfig: true, configPath: "<zero-config>", manualEndpoints: 0 },
    };
    mock(generateWithAllFrameworks).mockResolvedValue(generated);
    const summary: IProjectSummary = {
      framework: "express",
      frameworks: ["express"],
      projectName: "p",
      baseUrl: "http://localhost",
      routesInCode: 1,
      withFormRequest: 1,
      withoutFormRequest: 0,
      bodiesAdded: 0,
      queriesAdded: 0,
      zeroConfig: true,
      configPath: "<zero-config>",
      manualEndpoints: 0,
      inferredVariables: 0,
      auth: { loginEndpoint: "POST /login" },
      warnings: [],
      evidence: [],
      health: {
        withValidationPercent: 100,
        withBodySchemaPercent: 100,
        withExamplesPercent: 100,
        withDescriptionPercent: 100,
      },
    };
    mock(summarizeWithAllFrameworks).mockResolvedValue(summary);
    const outcome: IGenerateOutcome = { code: 0, report: { version: 3, ok: true, framework: "express", frameworks: ["express"], warnings: [], projectRoot: "/tmp", projectName: "p", collectionPath: "/tmp/collection.json", collectionId: "abc", environmentPaths: [], extraPaths: [], requests: 1, folders: 0, auth: null, durationMs: 1 } };
    mock(runGenerate).mockResolvedValue(outcome);
    mock(browseDirectory).mockResolvedValue({ ok: true, path: "/tmp", parent: "/", entries: [], truncated: false });
    const dryRun: IDryRunPlan = { ok: true, outputDir: "/tmp", projectName: "p", framework: "express", requests: 1, files: [], overwrites: 0, warnings: [] };
    mock(planDryRun).mockReturnValue(dryRun);
    mock(readSettings).mockResolvedValue({ settings: { version: 1 }, problem: null });
    mock(patchSettings).mockResolvedValue({ version: 1, locale: "en", theme: "dark" });
    mock(readHistory).mockResolvedValue({ ok: true, entries: [], rejected: [], totalEntries: 0 });
    const signal = vi.spyOn(process, "once").mockImplementation((event, listener) => {
      if (event === "SIGINT") listener();
      return process;
    });
    try {
      expect(await uiMain(["--no-open", "--port", "1"])).toBe(0);
      const options = mock(startUiServer).mock.calls.at(-1)?.[0];
      expect(options?.port).toBe(1);
      const deps = options?.deps;
      expect(deps).toBeDefined();
      expect(await deps!.locales()).toEqual({ locales: [], rejected: [] });
      expect(await deps!.readSettings()).toEqual({ settings: { version: 1 }, problem: null });
      expect(await deps!.patchSettings({ theme: "light" })).toEqual({ version: 1, locale: "en", theme: "dark" });
      expect(await deps!.browse("/tmp")).toMatchObject({ ok: true });
      expect(await deps!.dryRun({ projectRoot: "/tmp", outputDir: "/out", formats: ["openapi"], framework: "express", frameworkSearchRoot: "src" })).toMatchObject({ ok: true });
      expect(await deps!.summarize("/tmp")).toMatchObject({ projectName: "p", framework: "express" });
      expect(await deps!.generate({ projectRoot: "/tmp", outputDir: "/out", formats: ["openapi"], framework: "express", frameworkSearchRoot: "src" })).toMatchObject({ requests: 1 });
      expect(deps!.formats()).toEqual(expect.any(Array));
      expect(deps!.frameworks()).toEqual(expect.any(Array));
      expect(await deps!.history({ limit: 1, projectRoot: "/tmp" })).toMatchObject({ ok: true });
      expect(await deps!.exists("/tmp")).toBe(true);
    } finally {
      signal.mockRestore();
    }
  });
});
