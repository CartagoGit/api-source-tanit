/**
 * El emisor de YAML.
 *
 * Este spec existe por una razón concreta: al principio no se emitía
 * YAML **precisamente** por miedo a estas reglas. La decisión se
 * revisó, y lo que la hace segura es citar toda cadena — así que lo que
 * hay que probar es justo eso, con los valores que corrompen un
 * documento en silencio.
 */
import { describe, expect, test } from "vitest";

import { toYaml } from "../../projects/core/helpers/yaml.helper";

describe("las cadenas peligrosas van citadas", () => {
  // La tabla del infierno de YAML: sin comillas, cada una de estas deja
  // de ser la cadena que era.
  test.each([
    ["sí", '"sí"'],
    ["yes", '"yes"'],
    ["no", '"no"'],
    ["on", '"on"'],
    ["off", '"off"'],
    ["true", '"true"'],
    ["null", '"null"'],
    ["~", '"~"'],
    ["", '""'],
    ["1.0", '"1.0"'],
    ["08", '"08"'],
    ["#comentario", '"#comentario"'],
    ["hola: mundo", '"hola: mundo"'],
    ["- guion", '"- guion"'],
    ["*ancla", '"*ancla"'],
    ["&ref", '"&ref"'],
  ])("%s se emite como %s", (input, expected) => {
    expect(toYaml({ v: input })).toBe(`v: ${expected}\n`);
  });

  test("un salto de línea se escapa, no rompe el bloque", () => {
    expect(toYaml({ v: "una\ndos" })).toBe('v: "una\\ndos"\n');
  });

  test("las comillas dentro se escapan", () => {
    expect(toYaml({ v: 'dice "hola"' })).toBe('v: "dice \\"hola\\""\n');
  });

  test("el unicode sobrevive", () => {
    expect(toYaml({ v: "añadió ñ y €" })).toBe('v: "añadió ñ y €"\n');
  });
});

describe("los números y booleanos NO van citados", () => {
  // Citarlos los convertiría en texto, que es el error simétrico.
  test("un número es un número", () => {
    expect(toYaml({ v: 42 })).toBe("v: 42\n");
    expect(toYaml({ v: 1.5 })).toBe("v: 1.5\n");
    expect(toYaml({ v: 0 })).toBe("v: 0\n");
  });

  test("un booleano es un booleano", () => {
    expect(toYaml({ v: true })).toBe("v: true\n");
    expect(toYaml({ v: false })).toBe("v: false\n");
  });

  test("null es null", () => {
    expect(toYaml({ v: null })).toBe("v: null\n");
  });

  test("NaN e Infinity no son YAML válido, así que salen como null", () => {
    expect(toYaml({ v: Number.NaN })).toBe("v: null\n");
    expect(toYaml({ v: Number.POSITIVE_INFINITY })).toBe("v: null\n");
  });
});

describe("las claves", () => {
  test("un identificador va sin comillas", () => {
    expect(toYaml({ openapi: "3.1.0" })).toBe('openapi: "3.1.0"\n');
  });

  // Las claves de OpenAPI son rutas y códigos de estado.
  test("una ruta va citada", () => {
    expect(toYaml({ "/api/users": 1 })).toBe('"/api/users": 1\n');
  });

  test("un código de estado va citado", () => {
    expect(toYaml({ "200": "OK" })).toBe('"200": "OK"\n');
  });

  test("un mime type va citado", () => {
    expect(toYaml({ "application/json": 1 })).toBe('"application/json": 1\n');
  });

  test("una clave reservada va citada", () => {
    expect(toYaml({ no: 1 })).toBe('"no": 1\n');
  });
});

describe("estructura", () => {
  test("objetos anidados se sangran de dos en dos", () => {
    expect(toYaml({ info: { title: "API", version: "1.0.0" } })).toBe(
      'info:\n  title: "API"\n  version: "1.0.0"\n',
    );
  });

  test("una lista de escalares", () => {
    expect(toYaml({ tags: ["a", "b"] })).toBe('tags:\n- "a"\n- "b"\n');
  });

  test("una lista de objetos pega el guion a la primera línea", () => {
    expect(toYaml({ servers: [{ url: "http://x" }] })).toBe(
      'servers:\n- url: "http://x"\n',
    );
  });

  test("un objeto vacío es `{}`, no una clave suelta", () => {
    expect(toYaml({ scopes: {} })).toBe("scopes: {}\n");
  });

  test("una lista vacía es `[]`", () => {
    expect(toYaml({ security: [] })).toBe("security: []\n");
  });

  test("`undefined` se omite en vez de emitir una clave sin valor", () => {
    expect(toYaml({ a: 1, b: undefined })).toBe("a: 1\n");
  });

  test("siempre termina en salto de línea", () => {
    expect(toYaml({ a: 1 }).endsWith("\n")).toBe(true);
  });
});

describe("un documento con la forma de un OpenAPI", () => {
  const doc = toYaml({
    openapi: "3.1.0",
    info: { title: "Mi API", version: "1.0.0" },
    servers: [{ url: "http://localhost:3000" }],
    paths: {
      "/api/users": {
        get: {
          summary: "List Users",
          parameters: [{ name: "page", in: "query", required: false }],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  });

  test("sale con la forma esperada", () => {
    expect(doc).toContain('openapi: "3.1.0"');
    expect(doc).toContain('  "/api/users":');
    // La secuencia se sangra al nivel de su clave, que es lo que hace
    // todo el mundo y lo que YAML permite.
    expect(doc).toContain('      - name: "page"');
    expect(doc).toContain('        "200":');
    expect(doc).toContain('          description: "OK"');
  });

  // La prueba de fuego: que un parser de verdad lo lea igual. No hay
  // librería de YAML en el repo, así que se comprueba la propiedad que
  // importa — ninguna cadena sin comillas — sobre el documento entero.
  test("ninguna cadena se ha quedado sin comillas", () => {
    for (const line of doc.split("\n")) {
      const value = /: (.+)$/.exec(line)?.[1];
      if (!value) continue;
      const ok =
        value.startsWith('"') ||
        value === "{}" ||
        value === "[]" ||
        value === "null" ||
        value === "true" ||
        value === "false" ||
        /^-?\d+(\.\d+)?$/.test(value);
      expect(ok, `sin citar: ${line}`).toBe(true);
    }
  });
});
