import { describe, expect, test } from "vitest";

import {
  prettyGroupName,
  stripComments,
  topGroupFor,
} from "../../service/route-parser.service";

describe("route-parser.service (pure helpers)", () => {
  describe("stripComments", () => {
    test("elimina comentarios de bloque /* ... */", () => {
      const src = `Route::get('/a', [Foo::class,'a']);
/* Route::get('/b', [Foo::class,'b']); */
Route::get('/c', [Foo::class,'c']);`;
      const stripped = stripComments(src);
      expect(stripped).not.toContain("/b");
      expect(stripped).toContain("/a");
      expect(stripped).toContain("/c");
    });

    test("elimina comentarios de línea //", () => {
      const src = `Route::get('/a', [Foo::class,'a']);
// Route::get('/b', [Foo::class,'b']);
Route::get('/c', [Foo::class,'c']);`;
      const stripped = stripComments(src);
      expect(stripped).not.toContain("/b");
    });

    test("preserva // cuando va precedido de : (URL tipo http://)", () => {
      const src = `$url = 'http://example.com/api';`;
      const stripped = stripComments(src);
      expect(stripped).toContain("http://example.com/api");
    });
  });

  describe("topGroupFor", () => {
    test("devuelve el primer segmento cuando la URI empieza por api/", () => {
      expect(topGroupFor("api/clientes")).toBe("clientes");
    });

    test("devuelve el primer segmento cuando la URI empieza por /api/", () => {
      expect(topGroupFor("/api/clientes")).toBe("clientes");
    });

    test("ignora sub-segmentos más profundos", () => {
      expect(topGroupFor("api/users/123")).toBe("users");
      expect(topGroupFor("api/pedidos/historial")).toBe("pedidos");
    });

    test("respeta el override prefijo → grupo", () => {
      expect(topGroupFor("api/tol/tecdoc", { "tol/tecdoc": "tol/tecdoc" })).toBe(
        "tol/tecdoc",
      );
    });

    test("URI vacía → (raíz)", () => {
      expect(topGroupFor("")).toBe("(raíz)");
    });

    test("URI que no es api → primer segmento", () => {
      expect(topGroupFor("alive")).toBe("alive");
    });
  });

  describe("prettyGroupName", () => {
    test("capitaliza", () => {
      expect(prettyGroupName("pedidos")).toBe("Pedidos");
    });

    test("sustituye - y _ por espacio", () => {
      expect(prettyGroupName("usuarios-activos")).toBe("Usuarios Activos");
      expect(prettyGroupName("mi_api")).toBe("Mi Api");
    });

    test("preserva / como separador", () => {
      expect(prettyGroupName("tol/tecdoc")).toBe("Tol/Tecdoc");
    });

    test("(raíz) → Raíz", () => {
      expect(prettyGroupName("(raíz)")).toBe("Raíz");
    });

    test("string vacío → Raíz", () => {
      expect(prettyGroupName("")).toBe("Raíz");
    });
  });
});
