/**
 * La pieza que faltaba, y las cuatro veces que su ausencia mordió.
 *
 * "La URL identifica la operación" vale en REST y no vale en GraphQL ni
 * en tRPC, donde hay un endpoint y lo que distingue una consulta de otra
 * es el nombre. Tres sitios respondían esa pregunta con tres fórmulas
 * distintas, y los tres fallaron por separado sobre el mismo ejemplo.
 */
import { describe, expect, test } from "vitest";

import {
  describeEndpoint,
  endpointKey,
  needsNameToDisambiguate,
} from "../../projects/core/helpers/route-identity.helper";

describe("endpointKey", () => {
  test("en REST, método y URI bastan", () => {
    expect(endpointKey({ method: "GET", uri: "/users" })).toBe(
      endpointKey({ method: "GET", uri: "/users" }),
    );
    expect(endpointKey({ method: "GET", uri: "/users" })).not.toBe(
      endpointKey({ method: "POST", uri: "/users" }),
    );
  });

  test("normaliza la URI, para que `/api/x` y `api/x` no sean dos", () => {
    expect(endpointKey({ method: "GET", uri: "/users" })).toBe(
      endpointKey({ method: "GET", uri: "users" }),
    );
  });

  test("el método no distingue por mayúsculas", () => {
    expect(endpointKey({ method: "get", uri: "/users" })).toBe(
      endpointKey({ method: "GET", uri: "/users" }),
    );
  });

  /**
   * EL caso. Cinco operaciones de GraphQL comparten `POST /graphql`, y
   * sin el nombre las cinco colapsan en una — que es exactamente lo que
   * pasaba en `dedupeSpecs`, en los invariantes y en `check`.
   */
  test("en RPC sobre POST, el nombre es lo único que las separa", () => {
    const operaciones = [
      { method: "POST", uri: "/graphql", name: "query users" },
      { method: "POST", uri: "/graphql", name: "query orders" },
      { method: "POST", uri: "/graphql", name: "mutation createUser" },
      { method: "POST", uri: "/graphql", name: "mutation deleteUser" },
      { method: "POST", uri: "/graphql", name: "query health" },
    ];
    const claves = new Set(operaciones.map(endpointKey));
    expect(claves.size).toBe(5);
  });

  test("el cuerpo separa dos variantes del mismo endpoint", () => {
    const a = endpointKey({ method: "POST", uri: "/users", body: '{"name":"x"}' });
    const b = endpointKey({ method: "POST", uri: "/users", body: '{"name":"y"}' });
    expect(a).not.toBe(b);
  });

  /**
   * Un nombre vacío no puede cambiar la clave: si lo hiciera, la misma
   * ruta vista por dos caminos —uno que rellena `displayName` y otro que
   * no— dejaría de coincidir consigo misma.
   */
  test("un nombre o un cuerpo vacíos no cambian la clave", () => {
    const base = endpointKey({ method: "GET", uri: "/users" });
    expect(endpointKey({ method: "GET", uri: "/users", name: "" })).toBe(base);
    expect(endpointKey({ method: "GET", uri: "/users", body: "" })).toBe(base);
    expect(endpointKey({ method: "GET", uri: "/users", name: undefined })).toBe(base);
  });
});

describe("describeEndpoint", () => {
  test("en REST basta con método y URI", () => {
    expect(describeEndpoint({ method: "GET", uri: "/users" })).toBe("GET /users");
  });

  /**
   * Tres `POST /graphql` idénticos en una lista de "faltan estas" no
   * dicen cuál buscar. Con el nombre, sí.
   */
  test("con nombre, dice cuál es", () => {
    expect(
      describeEndpoint({ method: "POST", uri: "/graphql", name: "query orders" }),
    ).toContain("(query orders)");
  });
});

describe("needsNameToDisambiguate", () => {
  test("un REST normal no lo necesita", () => {
    expect(
      needsNameToDisambiguate([
        { method: "GET", uri: "/users" },
        { method: "POST", uri: "/users" },
        { method: "GET", uri: "/orders" },
      ]),
    ).toBe(false);
  });

  test("varias operaciones en el mismo endpoint sí", () => {
    expect(
      needsNameToDisambiguate([
        { method: "POST", uri: "/graphql", name: "a" },
        { method: "POST", uri: "/graphql", name: "b" },
      ]),
    ).toBe(true);
  });

  /**
   * Se pregunta por la forma de las rutas, no por una lista de
   * frameworks: así un JSON-RPC escrito a mano funciona sin que nadie
   * añada nada, y soportar un framework nuevo no obliga a tocar esto.
   */
  test("no depende de qué framework sea", () => {
    expect(
      needsNameToDisambiguate([
        { method: "POST", uri: "/rpc", name: "sumar" },
        { method: "POST", uri: "/rpc", name: "restar" },
      ]),
    ).toBe(true);
  });

  test("una lista vacía o de uno no necesita nada", () => {
    expect(needsNameToDisambiguate([])).toBe(false);
    expect(needsNameToDisambiguate([{ method: "GET", uri: "/x" }])).toBe(false);
  });
});
