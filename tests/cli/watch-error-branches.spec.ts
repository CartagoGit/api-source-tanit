import { afterEach, describe, expect, test, vi } from "vitest";
import { generateWithAllFrameworks } from "../../packages/frameworks/index.js";
import { main as watchMain } from "../../packages/cli/commands/watch.script";

vi.mock("../../packages/frameworks/index.js", () => ({ generateWithAllFrameworks: vi.fn() }));

const result = {
  collection: {
    info: { name: "watch" },
    item: [{ name: "health", request: { method: "GET", header: [], url: { raw: "http://x/health", host: ["x"], path: ["/health"] } } }],
  },
  specs: [],
  config: {
    name: "watch",
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
  match: null,
} as never;

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
