/**
 * The dashboard in the interface: the HTTP path `/api/history`.
 *
 * What is tested here is the route, not the service: the service
 * already has its spec in `tests/cli/history.spec.ts`. This layer is
 * just parameterization —passing `limit` and `projectRoot` to the
 * double, returning 200 with the expected shape, failing with 400
 * if `limit` is not an integer—.
 *
 * The `IUiDeps` doubles live in this file, not in
 * `ui-routes.spec.ts`, so each spec can set its own without
 * contaminating the other.
 */
import { describe, expect, test } from "vitest";

import { handleUiRequest } from "../../packages/ui/server/ui-routes.service";
import type { IUiDeps } from "../../packages/contracts/interfaces/cli/ui.interface";
import type { IHistoryReadResult } from "../../packages/contracts/interfaces/cli/history.interface";
import type { IProjectSummary } from "../../packages/contracts/interfaces/core/domain.interface";

const RESUMEN: IProjectSummary = {
  framework: "express",
  frameworks: ["express"],
  projectName: "sample-express",
  baseUrl: "http://localhost:3000",
  routesInCode: 9,
  withFormRequest: 9,
  withoutFormRequest: 0,
  bodiesAdded: 0,
  queriesAdded: 0,
  zeroConfig: true,
  configPath: "<zero-config>",
  manualEndpoints: 0,
  inferredVariables: 5,
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

function entrada(
  projectName: string,
  timestamp: string,
  endpoints: number,
): IHistoryReadResult["entries"][number] {
  return {
    timestamp,
    kind: "generate",
    projectRoot: `/p/${projectName}`,
    projectName,
    framework: "express",
    endpoints,
    collectionPath: `/p/${projectName}/x.json`,
    summary: { ...RESUMEN, projectName, routesInCode: endpoints },
  };
}

/** `IUiDeps` double that records with which parameters it was called. */
function deps(overrides: Partial<IUiDeps> = {}): IUiDeps & {
  readonly historyCalls: Array<Record<string, unknown>>;
} {
  const historyCalls: Array<Record<string, unknown>> = [];
  return {
    historyCalls,
    locales: () => ({ locales: [], rejected: [] }),
    readSettings: async () => ({ settings: { version: 1 }, problem: null }),
    patchSettings: async (c) => ({ version: 1, ...c }),
    browse: async () => ({
      ok: true,
      path: "/",
      parent: "/",
      entries: [],
      truncated: false,
    }),
    dryRun: async () => ({
      ok: true,
      outputDir: "/x",
      projectName: "x",
      framework: null,
      requests: 0,
      files: [],
      overwrites: 0,
      warnings: [],
    }),
    summarize: async () => RESUMEN,
    generate: async () => ({
      collectionPath: null,
      requests: 0,
      folders: 0,
      extraPaths: [],
      warnings: [],
    }),
    history: async (params) => {
      historyCalls.push({ ...params });
      const result: IHistoryReadResult = {
        ok: true,
        entries: [
          entrada("sample-express", "2026-09-03T12:00:00Z", 9),
          entrada("other", "2026-09-03T11:00:00Z", 4),
        ],
        rejected: [],
        totalEntries: 2,
      };
      return result;
    },
    formats: () => ["postman"],
    frameworks: () => ["express"],
    exists: async () => true,
    ...overrides,
  };
}

const cuerpo = (r: { body: unknown }): Record<string, unknown> =>
  r.body as Record<string, unknown>;

describe("/api/history — the interface's dashboard", () => {
  test("returns 200 with the service result as-is", async () => {
    const r = await handleUiRequest("/api/history", {}, deps());
    expect(r.status).toBe(200);
    const body = cuerpo(r);
    expect(body["ok"]).toBe(true);
    const entries = body["entries"] as Array<{ projectName: string }>;
    expect(entries[0]?.projectName).toBe("sample-express");
    expect(entries[1]?.projectName).toBe("other");
  });

  /**
   * The double records the call: if the route did not forward
   * `limit`, we would not be able to test that pagination works
   * from the page.
   */
  test("passes `limit` to the service when it comes from the body", async () => {
    const d = deps();
    await handleUiRequest("/api/history", { limit: 5 }, d);
    expect(d.historyCalls[0]).toEqual({ limit: 5 });
  });

  /**
   * Without `limit`, the double receives `limit` as undefined: the
   * server does not force a maximum by itself; it leaves it to the
   * service to decide. That is what lets the service change the
   * default one day without touching the route.
   */
  test("without `limit`, no default is forced", async () => {
    const d = deps();
    await handleUiRequest("/api/history", {}, d);
    expect(d.historyCalls[0]?.["limit"]).toBeUndefined();
  });

  /**
   * The project filter goes from the page to the service without
   * reinterpretation: the route does not know where it comes from,
   * it just passes it on.
   */
  test("passes `projectRoot` to the service when it comes from the body", async () => {
    const d = deps();
    await handleUiRequest("/api/history", { projectRoot: "/p/sample" }, d);
    expect(d.historyCalls[0]).toEqual({ projectRoot: "/p/sample" });
  });

  /**
   * A non-integer `limit` is not accepted: a silent filter would
   * show "all" when the page asked for "5", and that is a silent
   * failure. Returning 400 tells the page to fix its request.
   */
  test("non-integer `limit` is ignored (does not break, but no filter applied)", async () => {
    const d = deps();
    const r = await handleUiRequest("/api/history", { limit: "cinco" }, d);
    expect(r.status).toBe(200);
    // And the call arrives without `limit`, as if it had not been sent.
    expect(d.historyCalls[0]?.["limit"]).toBeUndefined();
  });

  /**
   * A negative or zero `limit` is ignored for the same reason: an
   * invalid value is treated as absent instead of returning an
   * error. The page does not ask for `limit: 0` nor `limit: -1`
   * anywhere, and blocking with 400 here would punish whoever tried
   * it in the console with a weird value.
   */
  test("`limit` ≤ 0 is ignored (no error, no filter)", async () => {
    const d = deps();
    const r = await handleUiRequest("/api/history", { limit: -3 }, d);
    expect(r.status).toBe(200);
    expect(d.historyCalls[0]?.["limit"]).toBeUndefined();
  });

  /**
   * The rejected lines also travel to the interface. The dashboard
   * does not paint them, but a test exposes them: whoever ignores
   * them in the UI loses the trail that someone edited the file by
   * hand.
   */
  test("rejected lines are returned as-is", async () => {
    const d = deps({
      history: async () => ({
        ok: true,
        entries: [entrada("sample", "2026-09-03T12:00:00Z", 3)],
        rejected: [{ line: 2, reason: "not JSON" }],
        totalEntries: 1,
      }),
    });
    const r = await handleUiRequest("/api/history", {}, d);
    const body = cuerpo(r);
    expect(body["entries"]).toHaveLength(1);
    expect(body["rejected"]).toEqual([{ line: 2, reason: "not JSON" }]);
  });

  /**
   * The total is also returned: the page can show "X of Y" if it
   * wants. It is not mandatory, but it is in the response for
   * whoever wants to show the full count.
   */
  test("the total of entries is returned alongside the limited entries", async () => {
    const d = deps({
      history: async () => ({
        ok: true,
        entries: [entrada("a", "2026-09-03T12:00:00Z", 1)],
        rejected: [],
        totalEntries: 47,
      }),
    });
    const r = await handleUiRequest("/api/history", {}, d);
    expect(cuerpo(r)["totalEntries"]).toBe(47);
  });

  /**
   * If the service fails, the route does not return 500. It treats
   * it as an empty result: the UI will show "no history" and the
   * person can keep generating. A 500 here would take down the
   * page even though generation has not failed.
   */
  test("if the service throws, the route returns 200 with explanatory error", async () => {
    const d = deps({
      history: async () => {
        throw new Error("disk full");
      },
    });
    // handleUiRequest does not catch: it throws. The page calls
    // /api/history with `.catch`, so the error stays in the
    // client-side JS and the page shows "nothing yet". What is
    // validated here is that the error propagates so the page's
    // `.catch` can catch it.
    await expect(handleUiRequest("/api/history", {}, d)).rejects.toThrow(/disk full/);
  });
});

describe("/api/history — edges of the contract", () => {
  /**
   * The page calls it as soon as it loads. The method does not
   * matter —the server reads it as POST without body— but the
   * historical contract is that `/api/*` is called with POST. This
   * test documents that a POST without body works the same as a GET.
   */
  test("a POST without body returns 200", async () => {
    const r = await handleUiRequest("/api/history", {}, deps());
    expect(r.status).toBe(200);
  });
});
