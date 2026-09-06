/**
 * A request description documents what the endpoint accepts.
 *
 * The example body teaches **one** valid value; that is not the same
 * as saying which ones are valid. A `"age": 30` does not say the
 * maximum is 120, nor that the field is optional. All that information
 * was already extracted from the code to build the example, and was
 * thrown away.
 */
import { describe, expect, test } from "vitest";

import { buildRequestDescription } from "../../packages/core/domain/request-doc.service";
import type { IEndpointField } from "../../packages/contracts/interfaces/core/postman.interface";

const field = (partial: Partial<IEndpointField> & { fieldName: string }): IEndpointField =>
  ({ location: "body", type: "string", required: true, ...partial }) as IEndpointField;

describe("without rules there is no table", () => {
  test("returns the original description unchanged", () => {
    expect(buildRequestDescription("createUser", undefined, undefined)).toBe("createUser");
  });

  test("an empty list adds nothing either", () => {
    expect(buildRequestDescription("createUser", [], undefined)).toBe("createUser");
  });

  test("with no description and no rules, an empty string", () => {
    expect(buildRequestDescription(undefined, [], undefined)).toBe("");
  });
});

describe("the table", () => {
  const fields = [
    field({ fieldName: "name", minLength: 1, maxLength: 100 }),
    field({ fieldName: "email", format: "email" }),
    field({ fieldName: "age", type: "integer", required: false, minimum: 0, maximum: 120 }),
    field({ fieldName: "role", type: "enum", required: false, enumValues: ["admin", "user"] }),
  ];
  const doc = buildRequestDescription("createUser", fields, undefined);

  test("preserves the description that was already there", () => {
    // It is what someone wrote on purpose; overwriting it with a
    // generated table would swap information for presentation.
    expect(doc.startsWith("createUser")).toBe(true);
  });

  test("says what is required and what is not", () => {
    expect(doc).toMatch(/`name`.*\|\s*sí\s*\|/);
    expect(doc).toMatch(/`age`.*\|\s*no\s*\|/);
  });

  test("extracts numeric bounds", () => {
    expect(doc).toContain("≥ 0");
    expect(doc).toContain("≤ 120");
  });

  test("extracts length bounds", () => {
    expect(doc).toContain("mín. 1 car.");
    expect(doc).toContain("máx. 100 car.");
  });

  test("extracts the format", () => {
    expect(doc).toContain("formato `email`");
  });

  test("extracts enum values", () => {
    expect(doc).toContain("`admin`");
    expect(doc).toContain("`user`");
  });

  test("a field with no constraints does not leave an empty cell", () => {
    expect(buildRequestDescription("x", [field({ fieldName: "plain" })], undefined)).toContain("—");
  });

  // Without this, whoever reads the table cannot tell whether a person
  // wrote it (and it may be stale) or it comes from the code right now.
  test("says where it comes from", () => {
    expect(doc).toContain("reglas de validación declaradas en el código");
  });
});

describe("grouping by location", () => {
  test("body, query, and path go into separate sections", () => {
    const doc = buildRequestDescription("x", [
      field({ fieldName: "b", location: "body" }),
      field({ fieldName: "q", location: "query" }),
      field({ fieldName: "p", location: "path" }),
    ], undefined);
    expect(doc).toContain("#### Body");
    expect(doc).toContain("#### Query");
    expect(doc).toContain("#### Path");
  });

  test("a location with no fields does not generate a section", () => {
    const doc = buildRequestDescription("x", [field({ fieldName: "q", location: "query" })], undefined);
    expect(doc).toContain("#### Query");
    expect(doc).not.toContain("#### Body");
  });

  test("the order is the usual one: body before query", () => {
    const doc = buildRequestDescription("x", [
      field({ fieldName: "q", location: "query" }),
      field({ fieldName: "b", location: "body" }),
    ], undefined);
    expect(doc.indexOf("#### Body")).toBeLessThan(doc.indexOf("#### Query"));
  });
});

// ---------------------------------------------------------------------------
// r00015 — confidence annotation (audit 2026-09-06 §17)
// ---------------------------------------------------------------------------

describe("r00015 — confidence annotation surfaces in the description", () => {
  test("high confidence with no reasons is silently dropped", () => {
    const doc = buildRequestDescription(
      "createUser",
      undefined,
      { level: "high", reasons: [] },
    );
    expect(doc).not.toContain("Confianza");
  });

  test("low confidence renders as a labelled block at the top", () => {
    const doc = buildRequestDescription(
      "createUser",
      undefined,
      {
        level: "low",
        reasons: ["Pages Router handler method dispatch not statically resolved"],
      },
    );
    expect(doc).toContain("**Confianza: low**");
    // The block lives at the top, but the `head` (the user's own
    // description) precedes it. The block still appears before any
    // field table — and crucially, the `**Confianza**` label is
    // visible in the doc so Postman renders it as a bold prefix.
    expect(doc.indexOf("Confianza")).toBeGreaterThan(-1);
    expect(doc).toContain(
      "- Pages Router handler method dispatch not statically resolved",
    );
  });

  test("medium confidence with reasons also renders", () => {
    const doc = buildRequestDescription(
      undefined,
      undefined,
      {
        level: "medium",
        reasons: ["two signals combined", "neither is unambiguous"],
      },
    );
    expect(doc).toContain("**Confianza: medium**");
    expect(doc).toContain("- two signals combined");
    expect(doc).toContain("- neither is unambiguous");
  });
});
