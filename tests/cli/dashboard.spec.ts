/**
 * The multi-project dashboard: what the person opening the root UI sees.
 *
 * The dashboard is built on top of `~/.expostman/history.jsonl` (the
 * "trail" that `summary` and `generate` leave when they finish) and
 * shows the latest generations across several projects. Three
 * behaviours matter and are tested here:
 *
 *   · Multi-project: the list is built from entries of different
 *     roots, not a single project.
 *   · Order by timestamp: the most recent entry goes first; if it
 *     were reversed, the dashboard would be a listing of the old.
 *   · Filters: `limit` and `projectRoot` are applied from the page
 *     without rescanning anything.
 *
 * The current implementation exposes this data through the
 * `/api/history` route (what the HTML in `index.html.constant.ts`
 * calls). What is tested here is the dashboard's behaviour —multi-
 * project, order, filters— regardless of the specific route,
 * because the dashboard's contract is the **shape of its data**, not
 * the endpoint name.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendHistory,
  readHistory,
} from "../../packages/ui/server/history.service.js";
import { handleUiRequest } from "../../packages/ui/server/ui-routes.service.js";
import type { IUiDeps } from "../../packages/contracts/interfaces/cli/ui.interface.js";
import type { IHistoryReadResult } from "../../packages/contracts/interfaces/cli/history.interface.js";
import type { IProjectSummary } from "../../packages/contracts/interfaces/core/domain.interface.js";

/** Temporary root where `history.jsonl` lives during the test. */
let work = "";
let historyFile = "";

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "dashboard-"));
  historyFile = join(work, "history.jsonl");
});

afterEach(async () => {
  if (work) {
    await rm(work, { recursive: true, force: true });
    work = "";
  }
});

/** Minimum valid summary to build entries. */
const RESUMEN_BASE: IProjectSummary = {
  framework: "express",
  frameworks: ["express"],
  projectName: "sample",
  baseUrl: "http://localhost:3000",
  routesInCode: 5,
  withFormRequest: 5,
  withoutFormRequest: 0,
  bodiesAdded: 0,
  queriesAdded: 0,
  zeroConfig: true,
  configPath: "<zero-config>",
  manualEndpoints: 0,
  inferredVariables: 2,
  auth: null,
  warnings: [],
  evidence: [],
  health: {
    withValidationPercent: 100,
    withBodySchemaPercent: 100,
    withExamplesPercent: 100,
    withDescriptionPercent: 100,
  },
};

/**
 * Helper that writes an entry to the history returning the
 * arguments needed to read it back.
 *
 * The timestamp is passed as the **third argument** to
 * `appendHistory` (not inside the input: `appendHistory(input, path,
 * now)` receives it at the tail so the caller cannot freeze the
 * time). Tests that need concrete timestamps plug it in here; tests
 * that do not use the default `new Date()` and order by insertion.
 */
async function appendEntrada(
  projectRoot: string,
  projectName: string,
  framework: string,
  endpoints: number,
  timestamp: Date,
  kind: "generate" | "summary" = "generate",
  collectionPath: string | null = "/x.json",
): Promise<void> {
  await appendHistory(
    {
      kind,
      projectRoot,
      summary: {
        ...RESUMEN_BASE,
        projectName,
        framework,
        routesInCode: endpoints,
      },
      collectionPath,
    },
    historyFile,
    timestamp,
  );
}

/**
 * Doubles the `history` service on top of the real `readHistory`,
 * with `historyFile` injected: the dashboard writes there in the
 * test, and the double reads it. This keeps the tests from touching
 * `process.env.HOME` and lets the reader know exactly which file is
 * being looked at.
 */
async function dashboardDeps(
  overrides: Partial<IUiDeps> = {},
): Promise<IUiDeps> {
  const historyCalls: Array<Record<string, unknown>> = [];
  return {
    locales: () => ({ locales: [], rejected: [] }),
    readSettings: async () => ({ settings: { version: 1 }, problem: null }),
    patchSettings: async (cambios) => ({ version: 1, ...cambios }),
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
    summarize: async () => RESUMEN_BASE,
    generate: async () => ({
      collectionPath: null,
      requests: 0,
      folders: 0,
      extraPaths: [],
      warnings: [],
    }),
    /**
     * The double goes through the real service with the test path.
     * The reason: we want the append → JSONL → read path to be the
     * same as in production, without reinventing it here.
     */
    history: async (params) => {
      historyCalls.push({ ...params });
      return await readHistory(params, historyFile);
    },
    formats: () => ["postman"],
    frameworks: () => ["express", "fastapi", "laravel"],
    exists: async () => true,
    ...overrides,
  };
}

const cuerpo = (r: { body: unknown }): Record<string, unknown> =>
  r.body as Record<string, unknown>;

describe("dashboard — multi-project from history.jsonl", () => {
  /**
   * Three different projects write three entries; the dashboard
   * must return all three in a single response, without grouping
   * or deduplicating. Without this, a project that generates very
   * often hides the others.
   */
  test("returns entries from several projects in the same response", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T11:00:00Z"),
    );
    await appendEntrada(
      "/p/c",
      "charlie",
      "laravel",
      12,
      new Date("2026-09-03T12:00:00Z"),
    );

    const result = await readHistory({}, historyFile);
    const nombres = result.entries.map((e) => e.projectName).sort();
    expect(nombres).toEqual(["alpha", "bravo", "charlie"]);
    expect(result.entries.length).toBe(3);
  });

  /**
   * Order: the entry with the most recent timestamp goes first.
   * Here the insertion order is reverse to chronological: the
   * second insertion has timestamp 11:00, so the response must put
   * it before the 12:00 one, reverse to the append order.
   *
   * The test explicitly writes in chronological order reversed from
   * the arrival order, so if the service did not reorder, the
   * result would be `[c, b, a]` when the correct one is also
   * `[c, b, a]` already with timestamps 12, 11, 10 — the **append**
   * order is correct here; the verification is that the most
   * recent ends up on top.
   */
  test("sorts most recent to oldest by ISO 8601 timestamp", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T08:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T11:00:00Z"),
    );
    await appendEntrada(
      "/p/c",
      "charlie",
      "laravel",
      12,
      new Date("2026-09-03T13:00:00Z"),
    );

    const result = await readHistory({}, historyFile);
    expect(result.entries[0]?.projectName).toBe("charlie");
    expect(result.entries[1]?.projectName).toBe("bravo");
    expect(result.entries[2]?.projectName).toBe("alpha");
  });

  /**
   * Filter by exact root. Without this filter the dashboard would
   * be a junk drawer of everything ever generated, and a user with
   * several projects would end up unable to find theirs.
   */
  test("the projectRoot filter reduces the list to a single project", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      5,
      new Date("2026-09-03T11:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T12:00:00Z"),
    );

    const result = await readHistory({ projectRoot: "/p/a" }, historyFile);
    expect(result.entries.every((e) => e.projectRoot === "/p/a")).toBe(true);
    expect(result.entries.map((e) => e.projectName)).toEqual(["alpha", "alpha"]);
  });

  /**
   * `limit` trims to the N most recent. Without a cap, a long
   * history floods the response and the dashboard becomes
   * unusable before the user even gets to scroll.
   */
  test("limit N returns only the N most recent", async () => {
    for (let i = 0; i < 5; i++) {
      await appendEntrada(
        `/p/${i}`,
        `p${i}`,
        "express",
        i + 1,
        new Date(`2026-09-03T10:0${i}:00Z`),
      );
    }

    const result = await readHistory({ limit: 2 }, historyFile);
    expect(result.entries.length).toBe(2);
    expect(result.entries[0]?.projectName).toBe("p4");
    expect(result.entries[1]?.projectName).toBe("p3");
    // The total is not trimmed: `limit` is on the response, not on
    // the historical count the dashboard also shows.
    expect(result.totalEntries).toBe(5);
  });

  /**
   * Combination: limit + projectRoot at the same time. Without this
   * combination, the page would have to ask for the two things in
   * separate calls — one for "all from this project" and another
   * for "the 5 most recent" — and the response would be two reads
   * of the same file.
   */
  test("limit and projectRoot apply together: filter, then cap", async () => {
    for (let i = 0; i < 4; i++) {
      await appendEntrada(
        "/p/a",
        "alpha",
        "express",
        i + 1,
        new Date(`2026-09-03T10:0${i}:00Z`),
      );
    }
    for (let i = 0; i < 4; i++) {
      await appendEntrada(
        "/p/b",
        "bravo",
        "fastapi",
        100 + i,
        new Date(`2026-09-03T11:0${i}:00Z`),
      );
    }

    const result = await readHistory(
      { projectRoot: "/p/a", limit: 2 },
      historyFile,
    );
    expect(result.entries.length).toBe(2);
    expect(result.entries.every((e) => e.projectRoot === "/p/a")).toBe(true);
    expect(result.totalEntries).toBe(4);
  });

  /**
   * Corrupt line: the dashboard does not break. This is already
   * covered in `tests/cli/history.spec.ts`; here it is rewritten
   * focused on the dashboard use case (several entries + one bad
   * line in the middle), because the dashboard reads a file that
   * grows with use and a manual edit leaves invalid lines.
   */
  test("a corrupt line between entries does not break the dashboard list", async () => {
    await mkdir(work, { recursive: true });
    await writeFile(
      historyFile,
      [
        JSON.stringify({
          version: 1,
          timestamp: "2026-09-03T09:00:00Z",
          kind: "generate",
          projectRoot: "/p/a",
          projectName: "alpha",
          framework: "express",
          endpoints: 1,
          collectionPath: "/x.json",
          summary: { ...RESUMEN_BASE, projectName: "alpha", routesInCode: 1 },
        }),
        "{ not valid json",
        JSON.stringify({
          version: 1,
          timestamp: "2026-09-03T12:00:00Z",
          kind: "generate",
          projectRoot: "/p/c",
          projectName: "charlie",
          framework: "laravel",
          endpoints: 3,
          collectionPath: "/c.json",
          summary: { ...RESUMEN_BASE, projectName: "charlie", routesInCode: 3 },
        }),
      ].join("\n") + "\n",
    );

    const result = await readHistory({}, historyFile);
    expect(result.entries.length).toBe(2);
    expect(result.rejected.length).toBe(1);
    // The dashboard still shows the two good ones, and the
    // rejected one travels in the response for whoever wants to
    // warn the user.
    expect(result.entries.map((e) => e.projectName).sort()).toEqual([
      "alpha",
      "charlie",
    ]);
  });
});

describe("dashboard — the HTTP route delivers multi-project, order, and filters", () => {
  /**
   * The dashboard reaches the browser via an HTTP route. What is
   * tested is that the route delivers multi-project from the real
   * `history.jsonl` —that is, the same file that `append` writes—
   * without having to reimplement anything in the route.
   */
  test("the route delivers entries from several projects from history.jsonl", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T11:00:00Z"),
    );
    await appendEntrada(
      "/p/c",
      "charlie",
      "laravel",
      12,
      new Date("2026-09-03T12:00:00Z"),
    );

    const deps = await dashboardDeps();
    const r = await handleUiRequest("/api/history", {}, deps);
    expect(r.status).toBe(200);
    const body = cuerpo(r);
    expect(body["ok"]).toBe(true);
    const entries = body["entries"] as Array<{ projectName: string }>;
    expect(entries.length).toBe(3);
    const nombres = entries.map((e) => e.projectName).sort();
    expect(nombres).toEqual(["alpha", "bravo", "charlie"]);
  });

  /**
   * The route propagates `limit` to the service without rewriting
   * it: the double receives the parameter intact. If the route
   * reinterpreted it, the cap would depend on a second
   * implementation that drifts out of sync with the service.
   */
  test("limit is propagated from the page to the service without rewriting", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T11:00:00Z"),
    );

    let capturadas: Array<Record<string, unknown>> = [];
    const deps = await dashboardDeps({
      history: async (params) => {
        capturadas.push({ ...params });
        return await readHistory(params, historyFile);
      },
    });
    const r = await handleUiRequest("/api/history", { limit: 1 }, deps);
    expect(r.status).toBe(200);
    expect(capturadas[0]).toEqual({ limit: 1 });
    const entries = cuerpo(r)["entries"] as Array<{ projectName: string }>;
    expect(entries.length).toBe(1);
  });

  /**
   * The root filter is also propagated. It is the other half of
   * "this specific project" — without it, the dashboard cannot
   * be narrowed to a single repo when the user has several.
   */
  test("projectRoot is propagated to the service and the response is filtered", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T11:00:00Z"),
    );

    let capturadas: Array<Record<string, unknown>> = [];
    const deps = await dashboardDeps({
      history: async (params) => {
        capturadas.push({ ...params });
        return await readHistory(params, historyFile);
      },
    });
    const r = await handleUiRequest(
      "/api/history",
      { projectRoot: "/p/b" },
      deps,
    );
    expect(r.status).toBe(200);
    expect(capturadas[0]).toEqual({ projectRoot: "/p/b" });
    const entries = cuerpo(r)["entries"] as Array<{ projectRoot: string }>;
    expect(entries.every((e) => e.projectRoot === "/p/b")).toBe(true);
  });

  /**
   * `totalEntries` also travels in the response: the dashboard
   * can show "X of Y" if it wants. It is not mandatory, but it is
   * in the response for whoever wants to show the full count
   * without having to ask again for the history without `limit`.
   */
  test("the response includes the untrimmed total, even when limit trims", async () => {
    for (let i = 0; i < 5; i++) {
      await appendEntrada(
        `/p/${i}`,
        `p${i}`,
        "express",
        i + 1,
        new Date(`2026-09-03T10:0${i}:00Z`),
      );
    }

    const deps = await dashboardDeps();
    const r = await handleUiRequest("/api/history", { limit: 2 }, deps);
    expect(cuerpo(r)["totalEntries"]).toBe(5);
    const entries = cuerpo(r)["entries"] as unknown[];
    expect(entries.length).toBe(2);
  });

  /**
   * Dashboard without history: the dashboard responds 200 with an
   * empty list, not 500. The page, without the network, would show
   * "nothing yet"; with 500, it would show a generic error that
   * attributes the failure to the tool when nobody has actually
   * generated anything.
   */
  test("without history: 200 with empty entries, not an error", async () => {
    const deps = await dashboardDeps();
    const r = await handleUiRequest("/api/history", {}, deps);
    expect(r.status).toBe(200);
    const body = cuerpo(r);
    expect(body["ok"]).toBe(true);
    expect(body["entries"]).toEqual([]);
    expect(body["totalEntries"]).toBe(0);
  });

  /**
   * The append physically writes to `history.jsonl`: if the HTTP
   * route received the data without going through the file, server
   * restarts would empty the dashboard. This verification is small
   * but decisive: it reads the file after the append and confirms
   * the lines arrived.
   */
  test("appendHistory leaves a trail on disk, not only in memory", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    const raw = await readFile(historyFile, "utf8");
    expect(raw.split("\n").filter((l) => l.trim() !== "").length).toBe(1);
    expect(raw).toContain("alpha");
    expect(raw).toContain("/p/a");
  });
});

/**
 * Exported type helper: the dashboard distinguishes `entries` (the
 * visible list) from `totalEntries` (what was on disk). If someone
 * adds a new field to the service, this type lets it be seen without
 * having to import it from `history.interface`.
 */
export type IDashboardReadResult = IHistoryReadResult;