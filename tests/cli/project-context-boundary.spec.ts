/**
 * La lista de quién puede leer el estado global de rutas.
 *
 * `lint:project-context` comprueba que nadie fuera de esa lista lo lea.
 * Esto comprueba **la lista misma**: un permiso sin motivo escrito es un
 * permiso que nadie podrá revisar dentro de seis meses, y una deuda sin
 * salida declarada es una deuda que se queda.
 *
 * La distinción entre `entrypoint`/`facade` y `debt` no es decorativa:
 * las dos primeras son permanentes y legítimas —un comando del CLI
 * resuelve su raíz porque es su trabajo—, la tercera es lo que falta por
 * migrar. Mezclarlas haría que la deuda dejara de contarse.
 */
import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";

import { EXCEPTIONS } from "../../scripts/gates/lint-project-context.script";
import { fromRoot } from "../../scripts/helpers/root.helper";

describe("las excepciones del candado", () => {
  test("hay al menos una, y no son todas deuda", () => {
    expect(EXCEPTIONS.length).toBeGreaterThan(0);
    expect(EXCEPTIONS.some((e) => e.kind !== "debt")).toBe(true);
  });

  test.for([...EXCEPTIONS])("$path apunta a algo que existe", ({ path }) => {
    expect(existsSync(fromRoot(path)), path).toBe(true);
  });

  /**
   * EL test. Un permiso sin motivo es un permiso que se copia sin
   * pensar. La frase tiene que decir algo, no rellenar el hueco.
   */
  test.for([...EXCEPTIONS])("$path explica por qué", ({ path, why }) => {
    expect(why.length, path).toBeGreaterThan(40);
  });

  /**
   * Una deuda tiene que decir **cómo se paga**. Sin eso queda como una
   * excepción permanente con otro nombre, que es como se quedan.
   */
  test.for(EXCEPTIONS.filter((e) => e.kind === "debt"))(
    "$path dice qué hace falta para dejar de ser deuda",
    ({ path, why }) => {
      expect(why, path).toMatch(/Se va cuando|Se va con|cuando esos/);
    },
  );

  test("no hay rutas repetidas: dos permisos para lo mismo esconden uno", () => {
    const rutas = EXCEPTIONS.map((e) => e.path);
    expect(new Set(rutas).size).toBe(rutas.length);
  });

  /**
   * La lista solo puede encoger. Este número es un techo medido, no una
   * meta: si sube, alguien ha añadido deuda en vez de pagarla.
   */
  test("la deuda declarada no crece", () => {
    const deuda = EXCEPTIONS.filter((e) => e.kind === "debt");
    expect(deuda.length).toBeLessThanOrEqual(3);
  });
});
