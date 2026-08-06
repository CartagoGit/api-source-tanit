import { describe, expect, test } from "vitest";

import { enrichCatalogWithFormRequests } from "../../frameworks/laravel/catalog-enricher.service";
import { buildCollection } from "../../services/collection-builder.service";
import type { EndpointSpec } from "../../contracts/postman.interface";
import type { ProjectConfig } from "../../contracts/project-config.interface";
import { mergeWithManual } from "../../services/endpoint-merge.service";

const spec = (partial: Partial<EndpointSpec>): EndpointSpec =>
  ({
    name: "Endpoint",
    method: "GET",
    uri: "/items",
    headers: [],
    query: [],
    ...partial,
  }) as EndpointSpec;

describe("mergeWithManual", () => {
  test("sin overrides devuelve el catálogo automático intacto", () => {
    const auto = [spec({ uri: "/users" })];
    expect(mergeWithManual(auto, [])).toEqual(auto);
  });

  test("el override gana en el nombre", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users", name: "Obtener Users" })],
      [spec({ method: "GET", uri: "/users", name: "Listado de clientes" })],
    );
    expect(merged[0]?.name).toBe("Listado de clientes");
  });

  test("el override gana en el body", () => {
    const merged = mergeWithManual(
      [spec({ method: "POST", uri: "/users", body: { a: 1 } })],
      [spec({ method: "POST", uri: "/users", body: { b: 2 } })],
    );
    expect(merged[0]?.body).toEqual({ b: 2 });
  });

  // El override corrige lo que el scanner deduce, pero no debe borrar
  // la referencia al FormRequest que el enricher necesita después.
  test("un override sin formRequest conserva el auto-detectado", () => {
    const merged = mergeWithManual(
      [spec({ method: "POST", uri: "/users", formRequest: "laravel:post /users" })],
      [spec({ method: "POST", uri: "/users", name: "Crear" })],
    );
    expect(merged[0]?.formRequest).toBe("laravel:post /users");
  });

  test("empareja aunque el parámetro se llame distinto", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users/{{id}}" })],
      [spec({ method: "GET", uri: "/users/{userId}", name: "Ver cliente" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("Ver cliente");
  });

  test("un endpoint manual que no existe en el código se añade", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users" })],
      [spec({ method: "POST", uri: "/webhooks/stripe", name: "Webhook" })],
    );
    expect(merged).toHaveLength(2);
    expect(merged[1]?.name).toBe("Webhook");
  });

  test("no confunde endpoints con el mismo path y distinto método", () => {
    const merged = mergeWithManual(
      [spec({ method: "GET", uri: "/users" }), spec({ method: "POST", uri: "/users" })],
      [spec({ method: "POST", uri: "/users", name: "Crear usuario" })],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.method === "GET")?.name).toBe("Endpoint");
    expect(merged.find((s) => s.method === "POST")?.name).toBe("Crear usuario");
  });

  test("un catálogo automático vacío devuelve solo los manuales", () => {
    const manual = [spec({ name: "Solo manual" })];
    expect(mergeWithManual([], manual)).toEqual(manual);
  });
});

const CONFIG: ProjectConfig = {
  name: "demo",
  collectionName: "Demo",
  collectionDescription: "",
  baseUrl: "http://localhost/api",
  variables: [{ key: "baseUrl", value: "http://localhost/api", type: "string" }],
  filePrefixes: {},
  zones: [],
  zoneOrder: [],
  defaultZone: "Otros",
  authDescriptions: {},
  loginEndpointName: "Login",
};

describe("enrichCatalogWithFormRequests", () => {
  test("sin índice de FormRequests no rompe la colección", async () => {
    const collection = buildCollection([spec({ uri: "/users" })], { ...CONFIG });
    const before = JSON.stringify(collection);
    const stats = await enrichCatalogWithFormRequests(collection, new Map());

    expect(stats.bodyVariants).toBe(0);
    expect(JSON.stringify(collection)).toBe(before);
  });

  test("cuenta como no resuelto lo que no encuentra", async () => {
    const collection = buildCollection([spec({ method: "POST", uri: "/users" })], {
      ...CONFIG,
    });
    const stats = await enrichCatalogWithFormRequests(
      collection,
      new Map([["POST users", "app/Http/Requests/NoExiste.php"]]),
    );
    expect(stats.resolved).toBe(0);
  });

  test("una colección vacía devuelve estadísticas en cero", async () => {
    const collection = buildCollection([], { ...CONFIG });
    const stats = await enrichCatalogWithFormRequests(collection, new Map());

    expect(stats).toMatchObject({
      bodyVariants: 0,
      queryVariants: 0,
      resolved: 0,
      unresolved: 0,
    });
    expect(stats.rulesWithUnknown).toEqual([]);
  });
});
