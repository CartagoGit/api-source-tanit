/**
 * Tests for `expandAllMethods` — the helper that turns the Hono
 * `.all()` sentinel (`method: "ALL"`) into seven standard verbs.
 *
 * x00056: "Hono `.all()` → exporters materializan el método 'ALL'"
 * (audit 2026-09-06 §13). The expansion lives in one helper and
 * each exporter consumes the result.
 */
import { describe, expect, test } from "vitest";

import {
  ALL_METHOD_MARKER,
  ALL_METHOD_VERBS,
  expandAllMethods,
  isAllMethodSpec,
} from "../../../packages/core/helpers/all-method.helper";
import type { EndpointSpec } from "../../../packages/contracts/interfaces/core/postman.interface";

function spec(partial: Partial<EndpointSpec> & Pick<EndpointSpec, "method" | "uri">): EndpointSpec {
  return {
    name: `Spec ${partial.method} ${partial.uri}`,
    ...partial,
  } as EndpointSpec;
}

describe("ALL_METHOD_VERBS — the seven standard verbs in stable order", () => {
  test("is exactly the seven non-sentinel HTTP verbs used by exporters", () => {
    expect(ALL_METHOD_VERBS).toEqual([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]);
  });

  test("does not contain 'ALL' (the sentinel that is being expanded away)", () => {
    expect(ALL_METHOD_VERBS).not.toContain("ALL");
  });
});

describe("isAllMethodSpec", () => {
  test("returns true only when the method is the 'ALL' sentinel", () => {
    expect(isAllMethodSpec(spec({ method: "ALL", uri: "/x" }))).toBe(true);
    for (const verb of ALL_METHOD_VERBS) {
      expect(isAllMethodSpec(spec({ method: verb, uri: "/x" }))).toBe(false);
    }
  });
});

describe("expandAllMethods", () => {
  test("a spec with method='ALL' produces exactly seven entries", () => {
    const out = expandAllMethods([spec({ method: "ALL", uri: "/anything" })]);
    expect(out).toHaveLength(7);
  });

  test("the seven entries carry the seven standard verbs in order", () => {
    const out = expandAllMethods([spec({ method: "ALL", uri: "/anything" })]);
    expect(out.map(({ spec: s }) => s.method)).toEqual([...ALL_METHOD_VERBS]);
  });

  test("every expanded entry carries the 'hono.all' marker", () => {
    const out = expandAllMethods([spec({ method: "ALL", uri: "/anything" })]);
    for (const { allMarker } of out) {
      expect(allMarker).toBe(ALL_METHOD_MARKER);
    }
  });

  test("the original name, uri, fields and body are preserved per verb", () => {
    const original = spec({
      method: "ALL",
      uri: "/items",
      name: "Items",
      fields: [{ fieldName: "id", location: "query", type: "string", required: false }],
      body: { ok: true },
      description: "all-verbs endpoint",
    });
    const out = expandAllMethods([original]);
    for (const { spec: s } of out) {
      expect(s.uri).toBe(original.uri);
      expect(s.name).toBe(original.name);
      expect(s.description).toBe(original.description);
      expect(s.fields).toEqual(original.fields);
      expect(s.body).toEqual(original.body);
    }
  });

  test("non-ALL specs pass through unchanged with no marker", () => {
    const original = spec({ method: "GET", uri: "/users" });
    const out = expandAllMethods([original]);
    expect(out).toHaveLength(1);
    expect(out[0]!.spec).toEqual(original);
    expect(out[0]!.allMarker).toBeUndefined();
  });

  test("mixing ALL and non-ALL preserves order and only expands the ALL ones", () => {
    const all = spec({ method: "ALL", uri: "/x" });
    const get = spec({ method: "GET", uri: "/y" });
    const post = spec({ method: "POST", uri: "/z" });
    const out = expandAllMethods([all, get, post]);
    // 7 (from all) + 1 (get) + 1 (post)
    expect(out).toHaveLength(9);
    // The first 7 are the expansion; 8th is the original GET; 9th the POST.
    expect(out[7]!.spec).toEqual(get);
    expect(out[8]!.spec).toEqual(post);
    // The expansion markers are present, the others are not.
    for (let i = 0; i < 7; i++) expect(out[i]!.allMarker).toBe(ALL_METHOD_MARKER);
    expect(out[7]!.allMarker).toBeUndefined();
    expect(out[8]!.allMarker).toBeUndefined();
  });

  test("empty input produces empty output", () => {
    expect(expandAllMethods([])).toEqual([]);
  });
});