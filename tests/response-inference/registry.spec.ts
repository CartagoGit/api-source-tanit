/**
 * The response-inference registry (proposal `r00020` S3).
 *
 * The registry is the **single place** that knows which inferrers
 * exist. The catalog (`RESPONSE_INFERRER_IDS`) is the contract and the
 * registry is what fulfills it — and this spec compares the two, so
 * neither can drift.
 */
import { describe, expect, test } from "vitest";

import {
  __resetResponseInferrersForTest,
  __setResponseInferrersForTest,
  inferrerIdForFramework,
  listResponseInferrerEntries,
  listResponseInferrers,
  registerResponseInferrer,
  selectInferrer,
  selectInferrerEntry,
} from "../../packages/core/responses/registry.js";
import {
  registerResponseInferrer as registerLegacyResponseInferrer,
} from "../../packages/core/responses/infer-responses.js";
import {
  RESPONSE_INFERRER_FRAMEWORKS,
  RESPONSE_INFERRER_IDS,
} from "../../packages/contracts/constants/core/response-inference.constant.js";
import type { ILegacyResponseInferrer } from "../../packages/contracts/interfaces/core/responses.interface.js";

/** A legacy inferrer, the shape the four original ones implement. */
function legacyStub(framework: string): ILegacyResponseInferrer {
  return {
    framework,
    infer: () => [],
  };
}

describe("response-inference registry (r00020 S3)", () => {
  test("the catalog declares the ten inferrers", () => {
    expect(RESPONSE_INFERRER_IDS).toHaveLength(10);
    expect(new Set(RESPONSE_INFERRER_IDS).size).toBe(10);
    for (const id of RESPONSE_INFERRER_IDS) {
      expect(RESPONSE_INFERRER_FRAMEWORKS[id], `no framework for ${id}`).toBeTruthy();
    }
  });

  test("the registry holds the six core inferrers the core ships", () => {
    __resetResponseInferrersForTest();
    const entries = listResponseInferrerEntries();
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.id).sort()).toEqual([
      "express",
      "fastify",
      "gin",
      "ktor-respond",
      "laravel-resources",
      "rails-render",
    ]);
  });

  test("selectInferrer finds the inferrer of a framework", () => {
    __resetResponseInferrersForTest();
    const inferrer = selectInferrer("fastify");
    expect(inferrer).not.toBeNull();
    expect(inferrer?.framework).toBe("fastify");
    expect(selectInferrerEntry("fastify")?.id).toBe("fastify");
  });

  test("selectInferrer answers null for a framework nobody serves", () => {
    __resetResponseInferrersForTest();
    expect(selectInferrer("cobol")).toBeNull();
    expect(selectInferrerEntry("cobol")).toBeNull();
  });

  test("the id of an inferrer is not the framework it serves", () => {
    __resetResponseInferrersForTest();
    expect(inferrerIdForFramework("laravel")).toBe("laravel-resources");
    expect(inferrerIdForFramework("rails")).toBe("rails-render");
    expect(inferrerIdForFramework("ktor")).toBe("ktor-respond");
    // `spring` is the odd one out: the framework is `springboot`.
    expect(inferrerIdForFramework("springboot")).toBe("spring");
    expect(inferrerIdForFramework("cobol")).toBeNull();
  });

  test("registering the four legacy inferrers completes the ten", () => {
    __resetResponseInferrersForTest();
    for (const framework of ["springboot", "nestjs", "fastapi", "aspnet"]) {
      registerLegacyResponseInferrer(legacyStub(framework));
    }
    expect(listResponseInferrerEntries()).toHaveLength(10);
    expect(listResponseInferrers()).toHaveLength(10);

    const ids = listResponseInferrerEntries().map((e) => e.id).sort();
    expect(ids).toEqual([...RESPONSE_INFERRER_IDS].sort());
  });

  test("one framework, one inferrer: registering again replaces", () => {
    __resetResponseInferrersForTest();
    registerLegacyResponseInferrer(legacyStub("fastify"));
    expect(listResponseInferrerEntries()).toHaveLength(6);
    expect(selectInferrer("fastify")?.framework).toBe("fastify");
  });

  test("an inferrer that disagrees with the catalog is refused", () => {
    __resetResponseInferrersForTest();
    expect(() =>
      registerResponseInferrer("fastify", {
        framework: "express",
        detect: () => false,
        infer: () => null,
      }),
    ).toThrow(/catalog/);
    __resetResponseInferrersForTest();
  });

  test("the test escape hatch replaces the whole registry", () => {
    __resetResponseInferrersForTest();
    __setResponseInferrersForTest([]);
    expect(listResponseInferrerEntries()).toHaveLength(0);
    expect(selectInferrer("fastify")).toBeNull();
    __resetResponseInferrersForTest();
  });
});
