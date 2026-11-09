/**
 * Parsing other people's files without `any` slipping in.
 *
 * The scanners read manifests and specs from other people. The pattern
 * that existed was `let parsed: any`, after which the type stopped
 * describing what was flowing around — exactly how `__params` got in.
 */
import { describe, expect, test } from "vitest";

import { declaredDependencies, isRecord, parseJson, readArray, readObject, readString } from "../../packages/core/helpers/parse-json.helper";

describe("parseJson", () => {
  test("returns the value when the JSON is valid", () => {
    const r = parseJson('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  test("returns the reason when it is not", () => {
    const r = parseJson("{roto");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });

  /**
   * The two cases were being confused: `JSON.parse("null")` returns
   * `null`, and a `catch` that also leaves `null` makes a corrupt file
   * and one that legitimately contains `null` end up identical. Only
   * one of the two deserves a warning.
   */
  test("distinguishes a legitimate `null` from a corrupt file", () => {
    const valido = parseJson("null");
    const roto = parseJson("nul");
    expect(valido.ok).toBe(true);
    if (valido.ok) expect(valido.value).toBeNull();
    expect(roto.ok).toBe(false);
  });
});

describe("the predicates scanners used to repeat by hand", () => {
  test.for([
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    ["texto", false],
    [42, false],
  ] as const)("isRecord(%j) → %s", ([valor, esperado]) => {
    expect(isRecord(valor)).toBe(esperado);
  });

  test("readObject returns objects only", () => {
    expect(readObject({ a: { b: 1 } }, "a")).toEqual({ b: 1 });
    expect(readObject({ a: [1] }, "a")).toBeUndefined();
    expect(readObject({ a: "x" }, "a")).toBeUndefined();
    expect(readObject(null, "a")).toBeUndefined();
  });

  test("readString rejects the empty string", () => {
    expect(readString({ a: "x" }, "a")).toBe("x");
    expect(readString({ a: "" }, "a")).toBeUndefined();
    expect(readString({ a: 1 }, "a")).toBeUndefined();
  });

  test("readArray returns arrays only", () => {
    expect(readArray({ a: [1, 2] }, "a")).toEqual([1, 2]);
    expect(readArray({ a: { 0: 1 } }, "a")).toBeUndefined();
  });
});

describe("declaredDependencies", () => {
  /**
   * THE case. Some scanners looked at `devDependencies` and others
   * did not, so the same project was detected or not depending on
   * which one asked. The question is "does this project use X?", and a
   * framework in `devDependencies` is still the project's framework.
   */
  test("merges dependencies and devDependencies", () => {
    const deps = declaredDependencies({
      dependencies: { express: "^4" },
      devDependencies: { vitest: "^1" },
    });
    expect(deps).toEqual({ express: "^4", vitest: "^1" });
  });

  test("`dependencies` wins when a package is in both", () => {
    const deps = declaredDependencies({
      dependencies: { x: "1.0.0" },
      devDependencies: { x: "2.0.0" },
    });
    expect(deps["x"]).toBe("1.0.0");
  });

  test("a manifest without the sections gives an empty object, does not crash", () => {
    expect(declaredDependencies({ name: "x" })).toEqual({});
    expect(declaredDependencies(null)).toEqual({});
    expect(declaredDependencies("no soy un objeto")).toEqual({});
  });

  test("a non-string version is ignored", () => {
    expect(declaredDependencies({ dependencies: { x: 1, y: "2" } })).toEqual({ y: "2" });
  });
});
