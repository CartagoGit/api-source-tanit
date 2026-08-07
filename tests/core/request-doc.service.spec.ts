/**
 * La descripción de una request documenta lo que el endpoint acepta.
 *
 * El body de ejemplo enseña **un** valor válido; eso no es lo mismo que
 * decir cuáles son válidos. Un `"age": 30` no cuenta que el máximo son
 * 120, ni que el campo es opcional. Toda esa información ya se extraía
 * del código para construir el ejemplo, y se tiraba.
 */
import { describe, expect, test } from "vitest";

import { buildRequestDescription } from "../../projects/core/domain/request-doc.service";
import type { IEndpointField } from "../../projects/core/contracts/postman.interface";

const field = (partial: Partial<IEndpointField> & { fieldName: string }): IEndpointField =>
  ({ location: "body", type: "string", required: true, ...partial }) as IEndpointField;

describe("sin reglas no hay tabla", () => {
  test("devuelve la descripción original tal cual", () => {
    expect(buildRequestDescription("createUser", undefined)).toBe("createUser");
  });

  test("una lista vacía tampoco añade nada", () => {
    expect(buildRequestDescription("createUser", [])).toBe("createUser");
  });

  test("sin descripción ni reglas, cadena vacía", () => {
    expect(buildRequestDescription(undefined, [])).toBe("");
  });
});

describe("la tabla", () => {
  const fields = [
    field({ fieldName: "name", minLength: 1, maxLength: 100 }),
    field({ fieldName: "email", format: "email" }),
    field({ fieldName: "age", type: "integer", required: false, minimum: 0, maximum: 120 }),
    field({ fieldName: "role", type: "enum", required: false, enumValues: ["admin", "user"] }),
  ];
  const doc = buildRequestDescription("createUser", fields);

  test("conserva la descripción que ya había", () => {
    // Es lo que alguien escribió a propósito; pisarlo con una tabla
    // generada sería cambiar información por presentación.
    expect(doc.startsWith("createUser")).toBe(true);
  });

  test("dice qué es obligatorio y qué no", () => {
    expect(doc).toMatch(/`name`.*\|\s*sí\s*\|/);
    expect(doc).toMatch(/`age`.*\|\s*no\s*\|/);
  });

  test("saca las cotas numéricas", () => {
    expect(doc).toContain("≥ 0");
    expect(doc).toContain("≤ 120");
  });

  test("saca las cotas de longitud", () => {
    expect(doc).toContain("mín. 1 car.");
    expect(doc).toContain("máx. 100 car.");
  });

  test("saca el formato", () => {
    expect(doc).toContain("formato `email`");
  });

  test("saca los valores de un enum", () => {
    expect(doc).toContain("`admin`");
    expect(doc).toContain("`user`");
  });

  test("un campo sin restricciones no deja la celda vacía", () => {
    expect(buildRequestDescription("x", [field({ fieldName: "plain" })])).toContain("—");
  });

  // Sin esto, quien lee la tabla no sabe si la escribió una persona (y
  // puede estar vieja) o si sale del código de ahora mismo.
  test("dice de dónde sale", () => {
    expect(doc).toContain("reglas de validación declaradas en el código");
  });
});

describe("agrupación por sitio", () => {
  test("body, query y path van en secciones distintas", () => {
    const doc = buildRequestDescription("x", [
      field({ fieldName: "b", location: "body" }),
      field({ fieldName: "q", location: "query" }),
      field({ fieldName: "p", location: "path" }),
    ]);
    expect(doc).toContain("#### Body");
    expect(doc).toContain("#### Query");
    expect(doc).toContain("#### Path");
  });

  test("un sitio sin campos no genera sección", () => {
    const doc = buildRequestDescription("x", [field({ fieldName: "q", location: "query" })]);
    expect(doc).toContain("#### Query");
    expect(doc).not.toContain("#### Body");
  });

  test("el orden es el habitual: body antes que query", () => {
    const doc = buildRequestDescription("x", [
      field({ fieldName: "q", location: "query" }),
      field({ fieldName: "b", location: "body" }),
    ]);
    expect(doc.indexOf("#### Body")).toBeLessThan(doc.indexOf("#### Query"));
  });
});
