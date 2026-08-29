/**
 * Las aserciones que lleva cada request.
 *
 * La regla que gobierna esto: **no se afirma nada que no se sepa**. Una
 * aserción falsa es peor que ninguna, porque falla en rojo y manda a
 * alguien a investigar un problema que no existe.
 */
import { describe, expect, test } from "vitest";

import { buildTestScript } from "../../packages/core/domain/test-script.service";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";

const spec = (method: EndpointSpec["method"]): EndpointSpec =>
  ({ name: "x", method, uri: "/x" }) as EndpointSpec;

const scriptOf = (method: EndpointSpec["method"]): string =>
  buildTestScript(spec(method)).script.exec.join("\n");

describe("el código esperado sale del verbo", () => {
  // Un 200 fijo daría rojo en una API perfectamente correcta: un POST
  // que crea contesta 201, y un DELETE contesta 204 sin cuerpo.
  test("un POST acepta el 201 de creación", () => {
    expect(scriptOf("POST")).toContain("201");
  });

  test("un DELETE acepta el 204 sin cuerpo", () => {
    expect(scriptOf("DELETE")).toContain("204");
  });

  test("un GET no espera un 201", () => {
    const codes = /include\(pm\.response\.code\)/.test(scriptOf("GET"));
    expect(codes).toBe(true);
    expect(scriptOf("GET")).not.toContain("[200, 201");
  });

  test("todos los verbos soportados producen script", () => {
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const) {
      expect(buildTestScript(spec(m)).script.exec.length).toBeGreaterThan(3);
    }
  });
});

describe("el cuerpo solo se comprueba si puede haberlo", () => {
  // `pm.response.json()` sobre un 204 lanza: no hay cuerpo que parsear.
  test("el test de JSON se salta los códigos sin cuerpo", () => {
    const script = scriptOf("POST");
    expect(script).toContain("204");
    expect(script).toMatch(/includes\(pm\.response\.code\)\) return/);
  });

  test("y también se salta lo que no sea JSON", () => {
    expect(scriptOf("GET")).toContain("Content-Type");
  });
});

describe("forma del evento", () => {
  test("es un evento `test`, no un `prerequest`", () => {
    expect(buildTestScript(spec("GET")).listen).toBe("test");
  });

  test("el tipo del script es el que Postman espera", () => {
    expect(buildTestScript(spec("GET")).script.type).toBe("text/javascript");
  });

  test("avisa de que está generado, para que nadie lo dé por escrito a mano", () => {
    expect(scriptOf("GET")).toContain("export-to-postman");
  });
});

describe("lo que NO se afirma", () => {
  /**
   * Este proyecto escanea lo que la API **recibe**. Lo que devuelve no
   * lo sabe, así que afirmar que un `GET /users` responde un array sería
   * adivinar — y fallaría en rojo en cualquier API que envuelva la
   * respuesta en `{ data: [...] }`.
   */
  test("no se afirma nada sobre la forma de la respuesta", () => {
    const script = scriptOf("GET");
    expect(script).not.toMatch(/to\.be\.an\(['"]array['"]\)/);
    expect(script).not.toMatch(/\.to\.have\.property/);
  });
});
