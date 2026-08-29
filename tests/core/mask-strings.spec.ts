/**
 * Distinguir el código de lo que es texto dentro del código.
 *
 * Es la pregunta que los scanners hacían sin saberlo: *¿esta llamada
 * está de verdad ahí, o está dentro de una cadena?* Un fichero con
 *
 *     const ayuda = 'usa router.get("/x") para registrar';
 *
 * producía un endpoint `GET /x` que no existe en ninguna parte.
 *
 * Y la mitad que es fácil olvidar: el path de una ruta **de verdad**
 * también es una cadena. Buscar en la máscara y leer de ella daría rutas
 * vacías, y el fallo sería silencioso — las rutas se descartarían una a
 * una sin que nada avise.
 */
import { describe, expect, test } from "vitest";

import { findOutsideStrings, maskStringLiterals } from "../../packages/core/helpers/source-scan.helper";

describe("maskStringLiterals", () => {
  // La longitud se conserva para que los desplazamientos de la máscara
  // valgan sobre el original. Sin eso haría falta un mapa de posiciones,
  // que es la clase de cosa que se desincroniza.
  test("conserva la longitud exacta", () => {
    for (const src of [
      `const a = "hola";`,
      `const a = 'con \\'escape\\' dentro';`,
      "const a = `plantilla ${x} y más`;",
      `const a = "sin cerrar`,
    ]) {
      expect(maskStringLiterals(src).length, src).toBe(src.length);
    }
  });

  test("vacía el contenido pero deja las comillas", () => {
    expect(maskStringLiterals(`x = "abc"`)).toBe(`x = "   "`);
    expect(maskStringLiterals(`x = 'abc'`)).toBe(`x = '   '`);
  });

  test("el código de fuera no se toca", () => {
    expect(maskStringLiterals(`router.get("/x")`)).toBe(`router.get("  ")`);
  });

  // Sin tratar el escape, un `"\\""` cierra donde no debe y a partir de
  // ahí se enmascara código de verdad.
  test("una comilla escapada no cierra la cadena", () => {
    const masked = maskStringLiterals(`x = "a\\"b"; router.get("/y")`);
    expect(masked).toContain("router.get(");
  });

  /**
   * Lo que va en `${…}` de una plantilla **sí** es código: es donde viven
   * las interpolaciones que otros lints tienen que ver.
   */
  test("la interpolación de una plantilla se conserva", () => {
    expect(maskStringLiterals("`a ${nombre} b`")).toContain("${nombre}");
  });

  // Si una comilla queda abierta es que no era una cadena; enmascarar
  // hasta el final se cargaría el resto del fichero.
  test("una comilla suelta no se come el resto del fichero", () => {
    const src = `const a = "sin cerrar\nrouter.get("/y")`;
    expect(maskStringLiterals(src)).toContain("router.get(");
  });
});

describe("findOutsideStrings", () => {
  const ROUTE = /(\w+)\s*\.\s*(get|post)\s*\(\s*(['"])([^'"\n]+)\3/gi;

  test("encuentra una llamada normal", () => {
    const found = findOutsideStrings(`router.get("/users", h);`, ROUTE);
    expect(found).toHaveLength(1);
    expect(found[0]?.match[4]).toBe("/users");
  });

  // La segunda mitad del truco: el path de una ruta de verdad ES una
  // cadena, así que hay que leerlo del original y no de la máscara.
  test("el path se lee del original, no de la máscara en blanco", () => {
    const found = findOutsideStrings(`router.post("/orders", h);`, ROUTE);
    expect(found[0]?.match[4]).toBe("/orders");
    expect(found[0]?.match[4]).not.toMatch(/^\s+$/);
  });

  test("descarta la llamada que vive dentro de una cadena", () => {
    const src = `const ayuda = 'usa router.get("/falsa") para registrar';`;
    expect(findOutsideStrings(src, ROUTE)).toEqual([]);
  });

  test("con las dos a la vez, solo cuenta la de verdad", () => {
    const src = [
      `const ayuda = 'usa router.get("/falsa")';`,
      `router.get("/real", h);`,
    ].join("\n");
    const found = findOutsideStrings(src, ROUTE);
    expect(found).toHaveLength(1);
    expect(found[0]?.match[4]).toBe("/real");
  });

  /**
   * `router.post(\n  "/x",\n  handler,\n)` es la forma normal en cuanto
   * hay middlewares, y un bucle por líneas no ve el path porque está en
   * otra línea que la llamada.
   */
  test("cruza saltos de línea", () => {
    const src = `router.post(\n  "/multilinea",\n  validate(schema),\n  handler,\n);`;
    const found = findOutsideStrings(src, ROUTE);
    expect(found[0]?.match[4]).toBe("/multilinea");
  });

  test("los comentarios se descartan antes de buscar", () => {
    const src = [
      `// router.get("/comentada");`,
      `/* router.post("/bloque"); */`,
      `router.get("/real");`,
    ].join("\n");
    const found = findOutsideStrings(src, ROUTE);
    expect(found.map((f) => f.match[4])).toEqual(["/real"]);
  });

  test("el índice apunta al sitio de verdad", () => {
    const src = `\n\nrouter.get("/x");`;
    expect(findOutsideStrings(src, ROUTE)[0]?.index).toBe(2);
  });

  // El regex que se pasa no se toca: mover su `lastIndex` rompería el
  // bucle de quien llama (ver `lint:regex-state`).
  test("no altera el regex que recibe", () => {
    ROUTE.lastIndex = 0;
    findOutsideStrings(`router.get("/a"); router.get("/b");`, ROUTE);
    expect(ROUTE.lastIndex).toBe(0);
  });

  test("sin coincidencias devuelve vacío", () => {
    expect(findOutsideStrings(`const x = 1;`, ROUTE)).toEqual([]);
  });
});
