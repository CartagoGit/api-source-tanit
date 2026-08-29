/**
 * El parser de YAML contra entradas que nadie escribió a mano.
 *
 * `parseYamlLite` son 267 líneas sin dependencias —el binario compilado
 * no puede cargar paquetes en ejecución— y leen specs OpenAPI **de otra
 * gente**: entrada no controlada, del framework con más endpoints
 * medidos del proyecto.
 *
 * Se golpeó con entradas raras antes de escribir esto, y la buena
 * noticia es que **nunca lanza y nunca se cuelga**. La mala es que esa
 * misma robustez lo hace peligroso: un spec que no sabe leer no se
 * distingue de uno vacío. `a: &x 1` devuelve la cadena `"&x 1"` en vez
 * del número, y nadie se entera hasta que la colección lleva valores que
 * no son los del spec.
 *
 * Las anclas no son exóticas en OpenAPI: es como se comparte una
 * respuesta de error entre veinte endpoints sin repetirla.
 *
 * De ahí las dos mitades de este fichero: las **invariantes**, que
 * valen para cualquier entrada, y la **detección**, que es lo que separa
 * «no lo soporto» de «te he mentido».
 */
import { describe, expect, test } from "vitest";

import { parseYamlLite, unsupportedYamlFeatures } from "../../packages/frameworks/scanners/openapi.scanner";

/** Trozos con los que se construyen documentos al azar. */
const PIEZAS = [
  "a: 1",
  "b: texto",
  "c: true",
  "d: null",
  "  anidado: 1",
  "\tcon-tabulador: 1",
  "- item",
  "  - item anidado",
  "e: |",
  "f: >",
  "# comentario",
  "",
  "   ",
  "g: 'comilla simple",
  'h: "sin cerrar',
  "i: http://x.com:8080/y",
  ": sin clave",
  "j:",
  "k: &ancla 1",
  "l: *ancla",
  "<<: *base",
  "---",
  "m: [1, 2, 3]",
  "n: { x: 1 }",
  "ñ: acentos y ünïcode",
  "o: 0x1F",
  'p: "\\u0000"',
];

/** Un generador reproducible: un fallo se puede volver a ver. */
function aleatorio(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function documento(rnd: () => number, lineas: number): string {
  return Array.from(
    { length: lineas },
    () => PIEZAS[Math.floor(rnd() * PIEZAS.length)] ?? "",
  ).join("\n");
}

describe("invariantes: valen para cualquier entrada", () => {
  /**
   * EL test. 500 documentos generados de trozos legales e ilegales
   * mezclados. Si alguno lanza o cuelga, el scanner de OpenAPI se lleva
   * por delante la generación entera de un proyecto.
   */
  test("nunca lanza, sobre 500 documentos generados", () => {
    const rnd = aleatorio(20260808);
    const fallos: string[] = [];
    for (let i = 0; i < 500; i++) {
      const src = documento(rnd, 1 + Math.floor(rnd() * 25));
      try {
        parseYamlLite(src);
      } catch (error) {
        fallos.push(`${(error as Error).message}\n--- entrada ---\n${src}`);
      }
    }
    expect(fallos, fallos[0] ?? "").toEqual([]);
  });

  test("termina: 200 documentos largos en menos de cinco segundos", () => {
    const rnd = aleatorio(1234);
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) parseYamlLite(documento(rnd, 200));
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  test("una anidación absurda no desborda la pila", () => {
    const profundo = Array.from({ length: 500 }, (_, i) => `${" ".repeat(i)}k${i}:`).join("\n");
    expect(() => parseYamlLite(profundo)).not.toThrow();
  });

  test("siempre devuelve algo, nunca `undefined`", () => {
    const rnd = aleatorio(77);
    for (let i = 0; i < 100; i++) {
      expect(parseYamlLite(documento(rnd, 10))).toBeDefined();
    }
  });

  test.for([
    ["vacío", ""],
    ["solo espacios", "   \n  \n"],
    ["solo comentarios", "# nada\n# aquí"],
    ["con BOM", "﻿a: 1"],
    ["truncado a media clave", "paths:\n  /users:\n    get"],
  ] as const)("%s no rompe", ([, src]) => {
    expect(() => parseYamlLite(src)).not.toThrow();
  });

  test("lo que parsea bien, lo parsea bien", () => {
    const spec = parseYamlLite(
      ["openapi: 3.0.0", "paths:", "  /users:", "    get:", "      summary: Listar"].join("\n"),
    ) as { openapi?: string; paths?: Record<string, Record<string, { summary?: string }>> };
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.paths?.["/users"]?.["get"]?.summary).toBe("Listar");
  });
});

describe("detección: lo que no sabe leer, lo dice", () => {
  test.for([
    ["anclas", "responses: &comun\n  '200': {}", "anclas"],
    ["alias", "responses: *comun", "alias"],
    ["claves de fusión", "<<: *base", "fusión"],
  ] as const)("avisa de %s", ([, src, esperado]) => {
    const encontrado = unsupportedYamlFeatures(src);
    expect(encontrado.length).toBeGreaterThan(0);
    expect(encontrado.join(" ")).toContain(esperado);
  });

  test("varios documentos en un fichero", () => {
    expect(unsupportedYamlFeatures("---\na: 1\n---\nb: 2\n").length).toBeGreaterThan(0);
  });

  /**
   * El fallo simétrico, y el que de verdad protege: si avisara de más,
   * cada spec normal saldría con un aviso y nadie los leería.
   */
  test("un spec normal no dispara ningún aviso", () => {
    const normal = [
      "openapi: 3.0.0",
      "info:",
      "  title: API",
      "paths:",
      "  /users/{id}:",
      "    get:",
      "      operationId: getUser",
      "      responses:",
      "        '200':",
      "          description: ok",
      "  /search:",
      "    get:",
      "      parameters:",
      "        - name: q",
      "          in: query",
    ].join("\n");
    expect(unsupportedYamlFeatures(normal)).toEqual([]);
  });

  test("una URL con `*` o `&` en un valor no es un ancla", () => {
    expect(unsupportedYamlFeatures("url: http://x.com/?a=1&b=2")).toEqual([]);
  });

  /**
   * Esto documenta el daño concreto, y por eso el aviso existe: el
   * parser no falla, devuelve la cadena literal.
   */
  test("sin el aviso, un ancla se cuela como texto", () => {
    const conAncla = parseYamlLite("a: &x 1\nb: *x") as Record<string, unknown>;
    expect(conAncla["a"]).toBe("&x 1");
    expect(conAncla["b"]).toBe("*x");
    // Y por eso hay que avisar.
    expect(unsupportedYamlFeatures("a: &x 1\nb: *x").length).toBe(2);
  });
});
