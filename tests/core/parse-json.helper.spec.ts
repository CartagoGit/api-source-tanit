/**
 * Parsear ficheros ajenos sin que `any` se cuele.
 *
 * Los scanners leen manifiestos y specs de otra gente. El patrón que
 * había era `let parsed: any` y a partir de ahí el tipo dejaba de
 * describir lo que circulaba — que es exactamente por donde entró
 * `__params`.
 */
import { describe, expect, test } from "vitest";

import { declaredDependencies, isRecord, parseJson, readArray, readObject, readString } from "../../projects/core/helpers/parse-json.helper";

describe("parseJson", () => {
  test("devuelve el valor cuando el JSON es válido", () => {
    const r = parseJson('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  test("devuelve el motivo cuando no lo es", () => {
    const r = parseJson("{roto");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });

  /**
   * Los dos casos se confundían: `JSON.parse("null")` devuelve `null`, y
   * un `catch` que también deja `null` hace que un fichero corrupto y
   * uno que legítimamente contiene `null` acaben iguales. Solo uno de
   * los dos merece un aviso.
   */
  test("distingue `null` legítimo de fichero corrupto", () => {
    const valido = parseJson("null");
    const roto = parseJson("nul");
    expect(valido.ok).toBe(true);
    if (valido.ok) expect(valido.value).toBeNull();
    expect(roto.ok).toBe(false);
  });
});

describe("los predicados que los scanners repetían a mano", () => {
  test.for([
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    ["texto", false],
    [42, false],
  ] as const)("isRecord(%j) → %s", ([valor, esperado]) => {
    expect(isRecord(valor)).toBe(esperado);
  });

  test("readObject solo devuelve objetos", () => {
    expect(readObject({ a: { b: 1 } }, "a")).toEqual({ b: 1 });
    expect(readObject({ a: [1] }, "a")).toBeUndefined();
    expect(readObject({ a: "x" }, "a")).toBeUndefined();
    expect(readObject(null, "a")).toBeUndefined();
  });

  test("readString rechaza la cadena vacía", () => {
    expect(readString({ a: "x" }, "a")).toBe("x");
    expect(readString({ a: "" }, "a")).toBeUndefined();
    expect(readString({ a: 1 }, "a")).toBeUndefined();
  });

  test("readArray solo devuelve arrays", () => {
    expect(readArray({ a: [1, 2] }, "a")).toEqual([1, 2]);
    expect(readArray({ a: { 0: 1 } }, "a")).toBeUndefined();
  });
});

describe("declaredDependencies", () => {
  /**
   * EL caso. Unos scanners miraban `devDependencies` y otros no, así que
   * el mismo proyecto se detectaba o no según cuál preguntara. La
   * pregunta es «¿este proyecto usa X?», y un framework en
   * `devDependencies` sigue siendo el framework del proyecto.
   */
  test("funde dependencies y devDependencies", () => {
    const deps = declaredDependencies({
      dependencies: { express: "^4" },
      devDependencies: { vitest: "^1" },
    });
    expect(deps).toEqual({ express: "^4", vitest: "^1" });
  });

  test("gana `dependencies` cuando el paquete está en las dos", () => {
    const deps = declaredDependencies({
      dependencies: { x: "1.0.0" },
      devDependencies: { x: "2.0.0" },
    });
    expect(deps["x"]).toBe("1.0.0");
  });

  test("un manifiesto sin bloques da un objeto vacío, no revienta", () => {
    expect(declaredDependencies({ name: "x" })).toEqual({});
    expect(declaredDependencies(null)).toEqual({});
    expect(declaredDependencies("no soy un objeto")).toEqual({});
  });

  test("una versión que no es cadena se ignora", () => {
    expect(declaredDependencies({ dependencies: { x: 1, y: "2" } })).toEqual({ y: "2" });
  });
});
