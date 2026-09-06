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
