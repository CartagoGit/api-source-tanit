/**
 * Response inference dispatcher tests (audit 2026-09-06 §10,
 * proposal `f00012` S1).
 *
 * Covers the six acceptance bullets the proposal lists for S1:
 *
 *   (a) registry vacío → `[]`
 *   (b) inferrer que devuelve `[]` → `[]`
 *   (c) inferrer que lanza → `[]` + log (warning captured)
 *   (d) dos inferrers encadenados → resultado concatenado
 *   (e) inferrer con `confidence: "high"` se preserva
 *   (f) ordenamiento estable por `(status, confidence desc)`
 */
import { describe, expect, test, beforeEach } from "vitest";

import {
  __setInferrersForTest,
  inferResponses,
} from "../../../packages/core/responses/infer-responses";
import type {
  EndpointSpecLike,
  IFrameworkSourceFileLike,
  IResponseInference,
  IResponseInferrer,
} from "../../../packages/contracts/interfaces/core/responses.interface";

const SPEC: EndpointSpecLike = {
  method: "GET",
  uri: "/users",
  sourceFile: "/app/users.controller.ts",
  lineNumber: 12,
};

const SOURCE: IFrameworkSourceFileLike = {
  path: "/app/users.controller.ts",
  content: "",
  framework: "nestjs",
};

/** Helper that builds an inferrer returning the given entries. */
function stubInferrer(
  framework: string,
  entries: ReadonlyArray<IResponseInference> | (() => ReadonlyArray<IResponseInference>),
  throwInstead = false,
): IResponseInferrer {
  return {
    framework,
    infer: () => {
      if (throwInstead) throw new Error("kaboom");
      return typeof entries === "function" ? entries() : entries;
    },
  };
}

describe("inferResponses dispatcher (f00012 S1)", () => {
  beforeEach(() => {
    __setInferrersForTest([]);
  });

  test("(a) empty registry returns []", () => {
    expect(inferResponses(SPEC, SOURCE)).toEqual([]);
  });

  test("(b) inferrer returning [] propagates as []", () => {
    __setInferrersForTest([stubInferrer("nestjs", [])]);
    expect(inferResponses(SPEC, SOURCE)).toEqual([]);
  });

  test("(c) a thrown inferrer becomes a warning, never aborts", () => {
    const warnings: unknown[][] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      __setInferrersForTest([
        stubInferrer("nestjs", [], /* throwInstead */ true),
      ]);
      const result = inferResponses(SPEC, SOURCE);
      expect(result).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]?.[0])).toContain("nestjs");
    } finally {
      console.warn = orig;
    }
  });

  test("(d) two inferrers concatenate their entries", () => {
    __setInferrersForTest([
      stubInferrer("nestjs", [
        { status: 200, schema: { kind: "empty" }, confidence: "high", reason: "@ApiOkResponse" },
      ]),
      stubInferrer("nestjs", [
        { status: 201, schema: { kind: "empty" }, confidence: "high", reason: "@ApiCreatedResponse" },
      ]),
    ]);
    const result = inferResponses(SPEC, SOURCE);
    expect(result).toHaveLength(2);
    const reasons = result.map((r) => r.reason).sort();
    expect(reasons).toEqual(["@ApiCreatedResponse", "@ApiOkResponse"]);
  });

  test("(e) confidence=high is preserved verbatim", () => {
    __setInferrersForTest([
      stubInferrer("nestjs", [
        {
          status: 200,
          schema: { kind: "ref", $ref: "UserDto" },
          confidence: "high",
          reason: "@ApiResponse",
        },
      ]),
    ]);
    const result = inferResponses(SPEC, SOURCE);
    expect(result[0]?.confidence).toBe("high");
  });

  test("(f) sort order: status asc, confidence desc", () => {
    __setInferrersForTest([
      stubInferrer("nestjs", [
        { status: 200, schema: { kind: "empty" }, confidence: "low", reason: "low" },
        { status: 200, schema: { kind: "empty" }, confidence: "high", reason: "high" },
        { status: 404, schema: { kind: "empty" }, confidence: "medium", reason: "missing" },
        { status: 500, schema: { kind: "empty" }, confidence: "low", reason: "err" },
      ]),
    ]);
    const result = inferResponses(SPEC, SOURCE);
    expect(result.map((r) => `${r.status}:${r.confidence}`)).toEqual([
      "200:high",
      "200:low",
      "404:medium",
      "500:low",
    ]);
  });

  test("dispatcher never returns entries with empty reason", () => {
    __setInferrersForTest([
      stubInferrer("nestjs", [
        { status: 200, schema: { kind: "empty" }, confidence: "low", reason: "" },
        { status: 201, schema: { kind: "empty" }, confidence: "low", reason: "explicit" },
      ]),
    ]);
    const result = inferResponses(SPEC, SOURCE);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(201);
  });
});

describe("inferResponses dispatcher — x00061 per-spec framework", () => {
  beforeEach(() => {
    __setInferrersForTest([]);
  });

  test("(1) frameworkHint overrides source.framework for the dispatcher", () => {
    // SOURCE says nestjs, but the route actually comes from a fastapi
    // handler. The hint must select the fastapi inferrer, not nestjs.
    __setInferrersForTest([
      stubInferrer("nestjs", [
        {
          status: 200,
          schema: { kind: "ref", $ref: "NestUserDto" },
          confidence: "high",
          reason: "NestJS return type",
        },
      ]),
      stubInferrer("fastapi", [
        {
          status: 200,
          schema: { kind: "ref", $ref: "FastAPIUserSchema" },
          confidence: "high",
          reason: "FastAPI return annotation",
        },
      ]),
    ]);
    const result = inferResponses(
      SPEC,
      { ...SOURCE, framework: "nestjs" },
      { frameworkHint: "fastapi" },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe("FastAPI return annotation");
    expect(result[0]?.schema).toEqual({ kind: "ref", $ref: "FastAPIUserSchema" });
  });

  test("(2) no hint → falls back to source.framework (legacy parity)", () => {
    __setInferrersForTest([
      stubInferrer("nestjs", [
        {
          status: 200,
          schema: { kind: "ref", $ref: "NestUserDto" },
          confidence: "high",
          reason: "NestJS return type",
        },
      ]),
      stubInferrer("fastapi", [
        {
          status: 200,
          schema: { kind: "ref", $ref: "FastAPIUserSchema" },
          confidence: "high",
          reason: "FastAPI return annotation",
        },
      ]),
    ]);
    const result = inferResponses(SPEC, { ...SOURCE, framework: "nestjs" });
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe("NestJS return type");
  });

  test("(3) unknown framework → empty result (no fallback to other inferrers)", () => {
    __setInferrersForTest([
      stubInferrer("nestjs", [
        {
          status: 200,
          schema: { kind: "empty" },
          confidence: "high",
          reason: "NestJS",
        },
      ]),
    ]);
    // Empty hint + empty source.framework → no inferrer matches → []
    const result = inferResponses(SPEC, { ...SOURCE, framework: "" });
    expect(result).toEqual([]);
  });
});

describe("inferResponsesIntoSpecs (f00014 follow-up)", () => {
  // f00014 follow-up: the helper that moves response inference from
  // the CLI loop (where it ran AFTER buildCollection and never made
  // it into the Postman output) into the pipeline. The new contract:
  //   - empty registry → registryEmpty=true, no spec is mutated
  //   - per-route framework wins over global framework (x00061)
  //   - global framework is the fallback for legacy routes
  //   - source file is read once and cached per (projectRoot, rel)
  //   - spec.responses is set on each enriched spec
  //   - routes with no sourceFile (manual / zero-config) skip silently

  beforeEach(() => {
    __setInferrersForTest([]);
  });

  test("(1) empty registry returns registryEmpty=true", async () => {
    __setInferrersForTest([]);
    const {
      inferResponsesIntoSpecs,
    } = await import("../../../packages/core/responses/infer-responses");
    const result = await inferResponsesIntoSpecs(
      [{ method: "GET", uri: "/users" }],
      "/tmp/nonexistent-project",
      [{ method: "GET", uri: "/users", sourceFile: "users.controller.ts" }],
      { globalFramework: "nestjs" },
    );
    expect(result.enrichedCount).toBe(0);
    expect(result.registryEmpty).toBe(true);
  });

  test("(2) no sourceFile → spec skipped silently", async () => {
    __setInferrersForTest([
      {
        framework: "nestjs",
        infer: () => [
          { status: 200, schema: { kind: "empty" }, confidence: "high", reason: "r" },
        ],
      },
    ]);
    const {
      inferResponsesIntoSpecs,
    } = await import("../../../packages/core/responses/infer-responses");
    const result = await inferResponsesIntoSpecs(
      [{ method: "GET", uri: "/users" }],
      "/tmp/nonexistent-project",
      [{ method: "GET", uri: "/users", sourceFile: null }],
      { globalFramework: "nestjs" },
    );
    expect(result.enrichedCount).toBe(0);
    expect(result.registryEmpty).toBe(false);
  });

  test("(3) per-route framework wins over global (x00061)", async () => {
    __setInferrersForTest([
      {
        framework: "nestjs",
        infer: () => [
          { status: 200, schema: { kind: "empty" }, confidence: "high", reason: "nestjs" },
        ],
      },
      {
        framework: "fastapi",
        infer: () => [
          { status: 200, schema: { kind: "empty" }, confidence: "high", reason: "fastapi" },
        ],
      },
    ]);
    const {
      inferResponsesIntoSpecs,
    } = await import("../../../packages/core/responses/infer-responses");
    const spec: { method: string; uri: string; sourceFile: string; responses?: unknown } = {
      method: "GET",
      uri: "/users",
      sourceFile: "test-source-for-per-route-fw.ts",
    };
    // The helper reads the source from disk, so we point at a
    // file we control. Tests live under tests/ and are committed.
    const result = await inferResponsesIntoSpecs(
      [spec],
      process.cwd(),
      [
        {
          method: "GET",
          uri: "/users",
          sourceFile: "tests/core/responses/infer-responses.spec.ts",
          framework: "nestjs",
        },
      ],
      { globalFramework: "fastapi" },
    );
    expect(result.enrichedCount).toBe(1);
    expect((spec.responses as Array<{ reason: string }>)[0]?.reason).toBe("nestjs");
  });

  test("(4) global framework is the fallback when route.framework is empty", async () => {
    __setInferrersForTest([
      {
        framework: "fastapi",
        infer: () => [
          { status: 200, schema: { kind: "empty" }, confidence: "high", reason: "fastapi-fallback" },
        ],
      },
    ]);
    const {
      inferResponsesIntoSpecs,
    } = await import("../../../packages/core/responses/infer-responses");
    const spec: { method: string; uri: string; sourceFile: string; responses?: unknown } = {
      method: "POST",
      uri: "/items",
      sourceFile: "test-source-for-global-fallback.ts",
    };
    const result = await inferResponsesIntoSpecs(
      [spec],
      process.cwd(),
      [
        {
          method: "POST",
          uri: "/items",
          sourceFile: "tests/core/responses/infer-responses.spec.ts",
          framework: null,
        },
      ],
      { globalFramework: "fastapi" },
    );
    expect(result.enrichedCount).toBe(1);
    expect((spec.responses as Array<{ reason: string }>)[0]?.reason).toBe("fastapi-fallback");
  });
});
