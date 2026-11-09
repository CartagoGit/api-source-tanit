import { afterEach, describe, expect, test, vi } from "vitest";
import { generateWithAllFrameworks } from "../../packages/frameworks/index.js";
import { main as watchMain } from "../../packages/cli/commands/watch.script";
import type { IGenerationResult } from "../../packages/contracts/interfaces/core/discovery.interface.js";

vi.mock("../../packages/frameworks/index.js", () => ({ generateWithAllFrameworks: vi.fn() }));

const result: IGenerationResult = {
  collection: {
    info: { name: "watch", description: "", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: [{ name: "health", request: { method: "GET", header: [], url: { raw: "http://x/health", host: ["x"], path: ["/health"] } } }],
    variable: [],
  },
  specs: [],
  config: {
    name: "watch",
    collectionName: "watch",
    collectionDescription: "",
    baseUrl: "http://x",
    variables: [],
    filePrefixes: {},
    zones: [],
    zoneOrder: [],
    defaultZone: "Other",
    authDescriptions: {},
    loginEndpointName: "Login",
    environments: [],
  },
  routes: [],
  match: null,
  origin: "scanner",
  authFlow: null,
  authScheme: { type: "none", evidence: "test" },
  context: {
    projectRoot: process.cwd(),
    packageRoot: process.cwd(),
    projectBasename: "watch",
    outputDir: process.cwd(),
  },
  warnings: [],
  frameworks: ["express"],
  project: { zeroConfig: true, configPath: "<zero-config>", manualEndpoints: 0 },
  metrics: {
    routes: 0,
    specs: 0,
    withValidation: 0,
    withoutValidation: 0,
    bodiesInferred: 0,
    queriesInferred: 0,
    responsesInferred: 0,
  },
};

afterEach(() => vi.mocked(generateWithAllFrameworks).mockReset());

describe("watch error and empty-option branches", () => {
  test("accepts each optional flag when its value is absent", async () => {
    vi.mocked(generateWithAllFrameworks).mockResolvedValue(result);
    for (const flag of ["--framework", "--framework-search-root", "--debounce", "--format"]) {
      expect(await watchMain(["--project-root", process.cwd(), "--once", flag])).toBe(0);
    }
  });

  test("prints a non-Error thrown value and returns one", async () => {
    vi.mocked(generateWithAllFrameworks).mockRejectedValue("generator exploded");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await watchMain(["--project-root", process.cwd(), "--once"])).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("generator exploded"));
    } finally {
      error.mockRestore();
    }
  });

  test("rejects a negative debounce before regenerating", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await watchMain(["--project-root", process.cwd(), "--once", "--debounce", "-5"])).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("`--debounce` espera"));
      expect(vi.mocked(generateWithAllFrameworks)).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
