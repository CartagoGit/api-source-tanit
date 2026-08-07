/**
 * El nombre de una request no es una ruta.
 *
 * `deriveName` pasaba el `displayName` del scanner por `toPostmanUri`,
 * que le pega una barra delante a todo lo que no la lleve — porque eso
 * es lo correcto para una URI. Para un nombre no: en Postman salía
 * `/POST /orders` donde el scanner de Next.js había puesto
 * `POST /orders`, y `/create_user` donde FastAPI había puesto el nombre
 * de la función.
 *
 * Afectaba a los seis scanners que ponen `displayName` (next.js, gin,
 * flask, symfony, spring boot, fastapi), y no lo veía nadie porque una
 * barra de más en un nombre no rompe la colección: solo la afea.
 *
 * Lo que sí hay que traducir en un nombre son los parámetros de ruta,
 * para que `GET /users/:id` se lea igual que su URI.
 */
import { describe, expect, test } from "vitest";

import {
  deriveName,
  toPostmanUri,
} from "../../projects/core/adapters/parsed-route-to-spec.adapter";
import type { ParsedRoute } from "../../projects/core/contracts/scanner.interface";

function nameOf(route: Partial<ParsedRoute> & { method: string; uri: string }): string {
  return deriveName(route as ParsedRoute);
}

describe("un displayName se respeta tal cual", () => {
  test("no le crece una barra delante", () => {
    expect(nameOf({ method: "POST", uri: "/orders", displayName: "POST /orders" })).toBe(
      "POST /orders",
    );
  });

  test("el nombre de una función se queda como está", () => {
    expect(nameOf({ method: "POST", uri: "/users", displayName: "create_user" })).toBe(
      "create_user",
    );
  });

  test("un nombre de ruta de Symfony se queda como está", () => {
    expect(nameOf({ method: "POST", uri: "/logout", displayName: "api_logout" })).toBe(
      "api_logout",
    );
  });

  test("no se colapsan las barras del nombre", () => {
    // Un nombre puede llevar `//` a propósito; no es una ruta que
    // normalizar.
    expect(
      nameOf({ method: "GET", uri: "/x", displayName: "GET https://api/x" }),
    ).toBe("GET https://api/x");
  });

  test("se le quitan los espacios de los bordes", () => {
    expect(nameOf({ method: "GET", uri: "/x", displayName: "  listUsers  " })).toBe(
      "listUsers",
    );
  });
});

describe("los parámetros sí se traducen", () => {
  test("`:id` de Express pasa a `{{id}}`", () => {
    expect(
      nameOf({ method: "GET", uri: "/users/:id", displayName: "GET /users/:id" }),
    ).toBe("GET /users/{{id}}");
  });

  test("`<int:id>` de Django pasa a `{{id}}`", () => {
    expect(
      nameOf({ method: "GET", uri: "/users/1", displayName: "GET /users/<int:id>" }),
    ).toBe("GET /users/{{id}}");
  });

  test("`{id}` de Laravel pasa a `{{id}}`", () => {
    expect(
      nameOf({ method: "GET", uri: "/users/1", displayName: "GET /users/{id}" }),
    ).toBe("GET /users/{{id}}");
  });

  test("lo que ya es `{{id}}` no se toca", () => {
    expect(
      nameOf({ method: "GET", uri: "/users/1", displayName: "GET /users/{{id}}" }),
    ).toBe("GET /users/{{id}}");
  });
});

describe("una URI sí se normaliza como URI", () => {
  // Es la diferencia con un nombre, y el motivo de que ahora sean dos
  // funciones distintas.
  test("le crece la barra inicial si el scanner la omite", () => {
    expect(toPostmanUri("users")).toBe("/users");
  });

  test("se le colapsan las barras repetidas", () => {
    expect(toPostmanUri("/api//v1///users")).toBe("/api/v1/users");
  });

  test("y también traduce los parámetros", () => {
    expect(toPostmanUri("/users/:id")).toBe("/users/{{id}}");
  });
});

/**
 * Un `GET` no lleva cuerpo, así que unas reglas de body en un `GET` no
 * pueden ser suyas: son las del vecino.
 *
 * Los providers que buscan "el esquema más cercano" cuando el handler no
 * referencia ninguno se lo cuelgan a cualquiera — el `GET /users` del
 * ejemplo de Express acababa con los campos del `POST /orders`. Mientras
 * esas reglas solo alimentaban el body de ejemplo no se veía, porque el
 * body ya se saltaba estos métodos; en cuanto empezaron a documentarse
 * y a salir en el OpenAPI, el documento describía un GET con cuerpo.
 */
describe("las reglas de body solo van a los métodos que lo aceptan", () => {
  test.each(["GET", "DELETE", "HEAD", "OPTIONS"] as const)(
    "un %s no conserva reglas de body",
    async (method) => {
      const { generateWithAllFrameworks } = await import("../../projects/frameworks/index");
      const { exampleDir } = await import("../../scripts/helpers/root.helper");
      const result = await generateWithAllFrameworks(exampleDir("express"));
      for (const spec of result.specs) {
        if (spec.method !== method) continue;
        const body = (spec.fields ?? []).filter((f) => f.location === "body");
        expect(body, `${spec.method} ${spec.uri}`).toEqual([]);
      }
    },
  );

  test("un POST sí las conserva", async () => {
    const { generateWithAllFrameworks } = await import("../../projects/frameworks/index");
    const { exampleDir } = await import("../../scripts/helpers/root.helper");
    const result = await generateWithAllFrameworks(exampleDir("express"));
    const post = result.specs.find((s) => s.method === "POST" && s.uri === "/api/users");
    expect((post?.fields ?? []).some((f) => f.location === "body")).toBe(true);
  });
});
