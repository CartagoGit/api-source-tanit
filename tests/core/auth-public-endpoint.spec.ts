/**
 * a00012 S3.b — Auth por operación.
 *
 * `defaultHeaders()` inyecta `Authorization: Bearer {{token}}` cuando
 * el esquema global es bearer. Antes lo hacía para **todas** las
 * requests, incluyendo el login —que es precisamente el endpoint que
 * emite el token. Resultado: 401 al primer Send, y la culpa apuntando
 * a una request que en realidad es lo que rellena la variable.
 *
 * El override por operación (`EndpointSpec.auth: { kind: "none" }`)
 * permite marcar endpoints públicos (login, /health, /register) para
 * que el builder omita esa cabecera sin tocar el esquema global.
 *
 * Estos tests son la garantía de esa regla: con un global `bearer`,
 * un endpoint declarado público sale sin `Authorization` mientras que
 * otro cualquiera del mismo proyecto sí la lleva.
 */
import { describe, expect, test } from "vitest";

import {
  buildCollection,
} from "../../packages/core/domain/collection-builder.service";
import type {
  EndpointSpec,
} from "../../packages/contracts/interfaces/core/postman.interface";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface";

const baseConfig: ProjectConfig = {
  name: "auth-public",
  collectionName: "Auth Public",
  collectionDescription: "test",
  baseUrl: "http://x",
  variables: [{ key: "baseUrl", value: "http://x", type: "string" }],
  filePrefixes: {},
  zones: [],
  zoneOrder: [],
  defaultZone: "Other",
  authDescriptions: {},
  loginEndpointName: "Login",
};

function spec(partial: Partial<EndpointSpec>): EndpointSpec {
  return {
    method: "GET",
    uri: "/x",
    headers: [],
    query: [],
    body: null,
    formRequest: null,
    ...partial,
  } as EndpointSpec;
}

/** Esquema global bearer (igual que el que infiere el detector cuando hay login). */
const bearerScheme = { type: "bearer" as const, evidence: "test" };

/**
 * Devuelve los headers de un item a partir de su nombre. Cero
 * carpetas: con `buildCollection` + dos endpoints en la raíz, basta
 * con un walk plano.
 */
function headersOf(collection: ReturnType<typeof buildCollection>, itemName: string) {
  for (const folder of collection.item) {
    for (const child of folder.item ?? []) {
      if (child.name === itemName) {
        return child.request?.header ?? [];
      }
    }
  }
  throw new Error(`No se encontró el item "${itemName}" en la colección`);
}

function hasAuthHeader(headers: Array<{ key: string; value?: string }>): boolean {
  return headers.some(
    (h) => h.key.toLowerCase() === "authorization" && (h.value ?? "").includes("Bearer"),
  );
}

describe("auth-public-endpoint — override por operación (a00012 S3.b)", () => {
  test("un endpoint público no lleva Authorization aunque el global sea bearer", () => {
    const col = buildCollection(
      [
        spec({
          name: "Login",
          method: "POST",
          uri: "/auth/login",
          // Override explícito: este endpoint es público.
          auth: { kind: "none" },
        }),
        spec({
          name: "ListUsers",
          method: "GET",
          uri: "/users",
        }),
      ],
      baseConfig,
      bearerScheme,
    );

    expect(hasAuthHeader(headersOf(col, "Login"))).toBe(false);
    expect(hasAuthHeader(headersOf(col, "ListUsers"))).toBe(true);
  });

  test("el override sólo afecta al endpoint que lo declara", () => {
    // Tres endpoints: uno público, dos protegidos. El header
    // `Authorization` aparece en los protegidos y NO en el público.
    const col = buildCollection(
      [
        spec({
          name: "Health",
          method: "GET",
          uri: "/health",
          auth: { kind: "none" },
        }),
        spec({
          name: "GetProfile",
          method: "GET",
          uri: "/me",
        }),
        spec({
          name: "ListOrders",
          method: "GET",
          uri: "/orders",
        }),
      ],
      baseConfig,
      bearerScheme,
    );

    expect(hasAuthHeader(headersOf(col, "Health"))).toBe(false);
    expect(hasAuthHeader(headersOf(col, "GetProfile"))).toBe(true);
    expect(hasAuthHeader(headersOf(col, "ListOrders"))).toBe(true);
  });

  test("sin override, todos los endpoints heredan el esquema global", () => {
    // El comportamiento por defecto se conserva: un endpoint que no
    // declara override sigue recibiendo la cabecera como antes.
    const col = buildCollection(
      [
        spec({ name: "A", method: "GET", uri: "/a" }),
        spec({ name: "B", method: "GET", uri: "/b" }),
      ],
      baseConfig,
      bearerScheme,
    );

    expect(hasAuthHeader(headersOf(col, "A"))).toBe(true);
    expect(hasAuthHeader(headersOf(col, "B"))).toBe(true);
  });

  test("con esquema global distinto de bearer, el override no cambia nada visible", () => {
    // El override `none` se aplica sobre la cabecera `Authorization`
    // que mete el builder; con scheme `none` global no se inyecta esa
    // cabecera en ningún caso, y el override queda como no-op.
    const col = buildCollection(
      [
        spec({
          name: "Health",
          method: "GET",
          uri: "/health",
          auth: { kind: "none" },
        }),
        spec({ name: "Me", method: "GET", uri: "/me" }),
      ],
      baseConfig,
      { type: "none", evidence: "test" },
    );

    expect(hasAuthHeader(headersOf(col, "Health"))).toBe(false);
    expect(hasAuthHeader(headersOf(col, "Me"))).toBe(false);
  });
});