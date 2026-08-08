/**
 * Leer un flag, con una sola respuesta.
 *
 * Había cuatro copias de esta función y no coincidían: dos devolvían
 * `null`, una `undefined`, y la cuarta tenía los argumentos al revés.
 * Nada de eso rompe el compilador — se manifiesta cuando alguien escribe
 * `flag === undefined` sobre la que devuelve `null`, o copia una llamada
 * de un fichero a otro y compila haciendo otra cosa.
 */
import { describe, expect, test } from "vitest";

import { hasFlag, readFlag } from "../../projects/core/helpers/argv.helper";

describe("readFlag", () => {
  test("lee `--flag valor`", () => {
    expect(readFlag(["--output-dir", "/tmp/x"], "--output-dir")).toBe("/tmp/x");
  });

  /**
   * La forma pegada la escribe la mitad de la gente y la generan casi
   * todos los scripts. Ninguna de las cuatro copias la soportaba: el
   * flag parecía no estar.
   */
  test("lee también `--flag=valor`", () => {
    expect(readFlag(["--output-dir=/tmp/x"], "--output-dir")).toBe("/tmp/x");
  });

  test("un flag ausente da `undefined`", () => {
    expect(readFlag(["--otro", "x"], "--output-dir")).toBeUndefined();
  });

  test("no confunde un flag con otro que empieza igual", () => {
    expect(readFlag(["--output", "f.json"], "--output-dir")).toBeUndefined();
  });

  /**
   * `--output-dir --json`: el siguiente argumento es otro flag, no un
   * valor. Sin esta comprobación, `--output-dir` sin valor se llevaba
   * `--json` por delante y el CLI escribía en una carpeta llamada
   * `--json`.
   */
  test("un flag sin valor no se lleva el siguiente flag", () => {
    expect(readFlag(["--output-dir", "--json"], "--output-dir")).toBeUndefined();
  });

  test("un flag al final, sin nada detrás", () => {
    expect(readFlag(["--output-dir"], "--output-dir")).toBeUndefined();
  });

  test("un valor vacío pegado es un valor vacío, no la ausencia del flag", () => {
    expect(readFlag(["--output-dir="], "--output-dir")).toBe("");
  });

  test("gana la primera aparición", () => {
    expect(readFlag(["--f", "a", "--f", "b"], "--f")).toBe("a");
  });
});

describe("hasFlag", () => {
  test("reconoce el flag suelto", () => {
    expect(hasFlag(["--json"], "--json")).toBe(true);
  });

  test("y el que trae valor pegado", () => {
    expect(hasFlag(["--format=openapi"], "--format")).toBe(true);
  });

  test("y dice que no cuando no está", () => {
    expect(hasFlag(["--otro"], "--json")).toBe(false);
  });
});
