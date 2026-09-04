/**
 * Qué esquema de autenticación usa la API.
 *
 * La colección salía **siempre** con `auth: { type: "bearer" }`. Una API
 * que autentica con `X-API-Key` recibía un bearer con un `{{token}}` que
 * nadie rellena nunca; una API sin autenticación **ninguna**, también. Y
 * encima cada petición llevaba una cabecera `Authorization: Bearer` sin
 * resolver, así que la respuesta era un 401 que no tenía nada que ver
 * con lo que se estaba probando.
 *
 * Este servicio es del núcleo: no puede mirar middlewares de Laravel ni
 * decoradores de NestJS. Deduce del resultado del escaneo, que es lo
 * único agnóstico que hay.
 */
import { describe, expect, test } from "vitest";

import { authVariablesFor, detectAuthScheme, toPostmanAuth } from "../../packages/core/domain/auth-scheme.service";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";
import { AUTH_API_KEY_VARIABLE } from "../../packages/contracts/constants/core/auth.constant";

function spec(partial: Partial<EndpointSpec> & { uri: string }): EndpointSpec {
  return {
    name: partial.uri,
    method: "GET",
    ...partial,
  } as EndpointSpec;
}

const header = (key: string) => ({ key, value: "", description: "" });

describe("sin ninguna señal", () => {
  test("no se inventa un esquema", () => {
    expect(detectAuthScheme([spec({ uri: "/users" })], false).type).toBe("none");
  });

  // Una colección con bloque `auth` vacío hace que Postman mande una
  // cabecera `Authorization` sin resolver en CADA petición.
  test("`none` no produce bloque `auth`", () => {
    expect(toPostmanAuth(detectAuthScheme([], false))).toBeNull();
  });

  test("y no pide variables que rellenar", () => {
    expect(authVariablesFor(detectAuthScheme([], false))).toEqual([]);
  });
});

describe("clave de API", () => {
  test("una cabecera `X-API-Key` repetida la delata", () => {
    const detected = detectAuthScheme(
      [
        spec({ uri: "/users", headers: [header("X-API-Key")] }),
        spec({ uri: "/orders", headers: [header("X-API-Key")] }),
      ],
      false,
    );
    expect(detected.type).toBe("apikey");
    expect(detected.keyName).toBe("X-API-Key");
    expect(detected.keyIn).toBe("header");
  });

  // Un endpoint suelto puede estar hablando con un tercero; no es el
  // esquema de esta API.
  test("en un solo endpoint no cuenta", () => {
    const detected = detectAuthScheme(
      [spec({ uri: "/users", headers: [header("X-API-Key")] })],
      false,
    );
    expect(detected.type).toBe("none");
  });

  test("también la reconoce en query", () => {
    const detected = detectAuthScheme(
      [
        spec({ uri: "/a", query: [{ key: "api_key", value: "" }] }),
        spec({ uri: "/b", query: [{ key: "api_key", value: "" }] }),
      ],
      false,
    );
    expect(detected.type).toBe("apikey");
    expect(detected.keyIn).toBe("query");
  });

  /**
   * `Authorization` es la del bearer. Confundirlas haría que una API con
   * login normal saliera configurada como API key.
   */
  test("`Authorization` NO es una clave de API", () => {
    const detected = detectAuthScheme(
      [
        spec({ uri: "/a", headers: [header("Authorization")] }),
        spec({ uri: "/b", headers: [header("Authorization")] }),
      ],
      true,
    );
    expect(detected.type).toBe("bearer");
  });

  test("el bloque de Postman lleva nombre, variable y sitio", () => {
    const auth = toPostmanAuth(
      detectAuthScheme(
        [
          spec({ uri: "/a", headers: [header("X-API-Key")] }),
          spec({ uri: "/b", headers: [header("X-API-Key")] }),
        ],
        false,
      ),
    );
    expect(auth?.type).toBe("apikey");
    const entries = auth?.["apikey"] as Array<{ key: string; value: string }>;
    expect(entries).toContainEqual({ key: "key", value: "X-API-Key", type: "string" });
    expect(entries).toContainEqual({
      key: "value",
      value: `{{${AUTH_API_KEY_VARIABLE}}}`,
      type: "string",
    });
    expect(entries).toContainEqual({ key: "in", value: "header", type: "string" });
  });

  test("pide la variable donde va la clave, y como secreto", () => {
    const vars = authVariablesFor({ type: "apikey", evidence: "" });
    expect(vars).toEqual([{ key: AUTH_API_KEY_VARIABLE, value: "", type: "secret" }]);
  });
});

describe("OAuth2", () => {
  test("un endpoint de token lo delata", () => {
    const detected = detectAuthScheme([spec({ uri: "/oauth/token", method: "POST" })], false);
    expect(detected.type).toBe("oauth2");
    expect(detected.tokenUrl).toBe("/oauth/token");
  });

  test("recoge también el de autorización si está", () => {
    const detected = detectAuthScheme(
      [spec({ uri: "/oauth2/token" }), spec({ uri: "/oauth2/authorize" })],
      false,
    );
    expect(detected.authorizeUrl).toBe("/oauth2/authorize");
  });

  test("pide clientId y clientSecret, los dos secretos", () => {
    const vars = authVariablesFor({ type: "oauth2", evidence: "" });
    expect(vars.map((v) => v.key)).toEqual(["clientId", "clientSecret"]);
    expect(vars.every((v) => v.type === "secret")).toBe(true);
  });
});

describe("bearer", () => {
  test("un flujo de login reconocido lo determina", () => {
    expect(detectAuthScheme([spec({ uri: "/users" })], true).type).toBe("bearer");
  });

  test("las credenciales ya vienen del flujo de login, no de aquí", () => {
    expect(authVariablesFor({ type: "bearer", evidence: "" })).toEqual([]);
  });
});

describe("prioridad entre señales", () => {
  // La clave de API es la señal más concreta: un nombre de cabecera
  // exacto repetido. Gana a la presencia de un login, que podría ser un
  // endpoint de sesión para otra cosa.
  test("la clave de API gana al flujo de login", () => {
    const detected = detectAuthScheme(
      [
        spec({ uri: "/a", headers: [header("X-API-Key")] }),
        spec({ uri: "/b", headers: [header("X-API-Key")] }),
      ],
      true,
    );
    expect(detected.type).toBe("apikey");
  });
});

describe("la evidencia", () => {
  // Una detección automática que no se puede contrastar es una que hay
  // que creerse a ciegas.
  test("cada esquema dice por qué se ha decidido", () => {
    for (const detected of [
      detectAuthScheme([], false),
      detectAuthScheme([spec({ uri: "/users" })], true),
      detectAuthScheme([spec({ uri: "/oauth/token" })], false),
    ]) {
      expect(detected.evidence.length).toBeGreaterThan(10);
    }
  });
});

describe("toPostmanAuth — formatos de bloque", () => {
  test("bearer produce el bloque con {{token}}", () => {
    const auth = toPostmanAuth({ type: "bearer", evidence: "" });
    expect(auth?.type).toBe("bearer");
    const entries = auth?.["bearer"] as Array<{ key: string; value: string }>;
    expect(entries).toContainEqual({ key: "token", value: "{{token}}", type: "string" });
  });

  test("oauth2 produce clientCredentials con tokenUrl", () => {
    const auth = toPostmanAuth({ type: "oauth2", tokenUrl: "/oauth/token", evidence: "" });
    expect(auth?.type).toBe("oauth2");
    const entries = auth?.["oauth2"] as Array<{ key: string; value: string }>;
    expect(entries.some((e) => e.key === "grant_type" && e.value === "client_credentials")).toBe(true);
    expect(entries.some((e) => e.key === "accessTokenUrl")).toBe(true);
  });

  test("oauth2 con authorizeUrl añade el campo authUrl", () => {
    const auth = toPostmanAuth({
      type: "oauth2",
      tokenUrl: "/oauth/token",
      authorizeUrl: "/oauth/authorize",
      evidence: "",
    });
    const entries = auth?.["oauth2"] as Array<{ key: string; value: string }>;
    expect(entries.some((e) => e.key === "authUrl" && e.value.includes("/oauth/authorize"))).toBe(true);
  });

  test("none devuelve null — sin bloque auth", () => {
    expect(toPostmanAuth({ type: "none", evidence: "" })).toBeNull();
  });
});

describe("countKeyUsage — API-key casing (x00023)", () => {
  // x00023: el bug era que `header.set(h.key, …)` guardaba por el case
  // original del primer header. `X-API-Key` y `x-api-key` en endpoints
  // distintos acababan en dos entradas de 1 cada una y el umbral de 2
  // no se alcanzaba. La fix acumula por clave canónica lowercase y
  // preserva aparte el primer nombre original como `displayName`.

  test("[X-API-Key, x-api-key] cuenta 2 bajo 'x-api-key' y conserva 'X-API-Key' como displayName", () => {
    const detected = detectAuthScheme(
      [
        spec({ uri: "/a", headers: [header("X-API-Key")] }),
        spec({ uri: "/b", headers: [header("x-api-key")] }),
      ],
      false,
    );
    expect(detected.type).toBe("apikey");
    expect(detected.keyIn).toBe("header");
    expect(detected.keyName).toBe("X-API-Key");
    expect(detected.evidence).toContain("aparece en 2 endpoints");
  });

  test("[x-api-key, X-API-KEY, X-Api-Key] mergea en una sola entrada con count 3", () => {
    const detected = detectAuthScheme(
      [
        spec({ uri: "/a", headers: [header("x-api-key")] }),
        spec({ uri: "/b", headers: [header("X-API-KEY")] }),
        spec({ uri: "/c", headers: [header("X-Api-Key")] }),
      ],
      false,
    );
    expect(detected.type).toBe("apikey");
    expect(detected.keyIn).toBe("header");
    // El primer nombre visto se queda como displayName.
    expect(detected.keyName).toBe("x-api-key");
    expect(detected.evidence).toContain("aparece en 3 endpoints");
  });

  test("regresión: dos endpoints con case mixto confirman API-key auth (antes daba 'none')", () => {
    // Antes del fix, este escenario terminaba en dos entradas de 1
    // (X-API-Key → 1, x-api-key → 1) y el detector concluía 'none'
    // porque ninguna llegaba al umbral de 2.
    const detected = detectAuthScheme(
      [
        spec({ uri: "/users", headers: [header("X-API-Key")] }),
        spec({ uri: "/orders", headers: [header("x-api-key")] }),
      ],
      false,
    );
    expect(detected.type).toBe("apikey");
    expect(detected.keyName).toBe("X-API-Key");
    expect(detected.keyIn).toBe("header");
  });

  test("query: [api_key, API_KEY, Api_Key] mergea en una sola entrada con count 3", () => {
    // Mismo patrón aplicado a query params: case mixto en distintos
    // endpoints contaba como 1 cada uno y no llegaba al umbral.
    const detected = detectAuthScheme(
      [
        spec({ uri: "/a", query: [{ key: "api_key", value: "" }] }),
        spec({ uri: "/b", query: [{ key: "API_KEY", value: "" }] }),
        spec({ uri: "/c", query: [{ key: "Api_Key", value: "" }] }),
      ],
      false,
    );
    expect(detected.type).toBe("apikey");
    expect(detected.keyIn).toBe("query");
    expect(detected.keyName).toBe("api_key");
    expect(detected.evidence).toContain("aparece en 3 endpoints");
  });
});
