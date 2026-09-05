/**
 * Which authentication scheme the API uses.
 *
 * The collection used to come out **always** with
 * `auth: { type: "bearer" }`. An API that authenticates with
 * `X-API-Key` got a bearer with a `{{token}}` that nobody ever fills
 * in; an API with **no** authentication at all, also. And on top of
 * that every request carried an unresolved `Authorization: Bearer`
 * header, so the response was a 401 that had nothing to do with what
 * was being tested.
 *
 * This service lives in the core: it cannot inspect Laravel middleware
 * or NestJS decorators. It infers from the scan result, which is the
 * only agnostic thing available.
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

describe("with no signal at all", () => {
  test("does not invent a scheme", () => {
    expect(detectAuthScheme([spec({ uri: "/users" })], false).type).toBe("none");
  });

  // A collection with an empty `auth` block makes Postman send an
  // unresolved `Authorization` header on EVERY request.
  test("`none` does not produce an `auth` block", () => {
    expect(toPostmanAuth(detectAuthScheme([], false))).toBeNull();
  });

  test("and does not ask for variables to fill in", () => {
    expect(authVariablesFor(detectAuthScheme([], false))).toEqual([]);
  });
});

describe("API key", () => {
  test("a repeated `X-API-Key` header gives it away", () => {
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

  // A lone endpoint may be talking to a third party; it is not this
  // API's scheme.
  test("on a single endpoint it does not count", () => {
    const detected = detectAuthScheme(
      [spec({ uri: "/users", headers: [header("X-API-Key")] })],
      false,
    );
    expect(detected.type).toBe("none");
  });

  test("also recognizes it in the query string", () => {
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
   * `Authorization` is the bearer's. Confusing the two would make an
   * API with normal login come out configured as an API key.
   */
  test("`Authorization` is NOT an API key", () => {
    const detected = detectAuthScheme(
      [
        spec({ uri: "/a", headers: [header("Authorization")] }),
        spec({ uri: "/b", headers: [header("Authorization")] }),
      ],
      true,
    );
    expect(detected.type).toBe("bearer");
  });

  test("the Postman block carries name, variable, and location", () => {
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

  test("asks for the variable where the key goes, and as a secret", () => {
    const vars = authVariablesFor({ type: "apikey", evidence: "" });
    expect(vars).toEqual([{ key: AUTH_API_KEY_VARIABLE, value: "", type: "secret" }]);
  });
});

describe("OAuth2", () => {
  test("a token endpoint gives it away", () => {
    const detected = detectAuthScheme([spec({ uri: "/oauth/token", method: "POST" })], false);
    expect(detected.type).toBe("oauth2");
    expect(detected.tokenUrl).toBe("/oauth/token");
  });

  test("also picks up the authorize endpoint if present", () => {
    const detected = detectAuthScheme(
      [spec({ uri: "/oauth2/token" }), spec({ uri: "/oauth2/authorize" })],
      false,
    );
    expect(detected.authorizeUrl).toBe("/oauth2/authorize");
  });

  test("asks for clientId and clientSecret, both as secrets", () => {
    const vars = authVariablesFor({ type: "oauth2", evidence: "" });
    expect(vars.map((v) => v.key)).toEqual(["clientId", "clientSecret"]);
    expect(vars.every((v) => v.type === "secret")).toBe(true);
  });
});

describe("bearer", () => {
  test("a recognized login flow determines it", () => {
    expect(detectAuthScheme([spec({ uri: "/users" })], true).type).toBe("bearer");
  });

  test("the credentials come from the login flow, not from here", () => {
    expect(authVariablesFor({ type: "bearer", evidence: "" })).toEqual([]);
  });
});

describe("priority between signals", () => {
  // The API key is the most concrete signal: a repeated exact header
  // name. It wins over the presence of a login, which could be a
  // session endpoint for something else.
  test("the API key wins over the login flow", () => {
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

describe("the evidence", () => {
  // An automatic detection that cannot be cross-checked is one you
  // have to take on faith.
  test("each scheme says why it was decided", () => {
    for (const detected of [
      detectAuthScheme([], false),
      detectAuthScheme([spec({ uri: "/users" })], true),
      detectAuthScheme([spec({ uri: "/oauth/token" })], false),
    ]) {
      expect(detected.evidence.length).toBeGreaterThan(10);
    }
  });
});

describe("toPostmanAuth — block formats", () => {
  test("bearer produces the block with {{token}}", () => {
    const auth = toPostmanAuth({ type: "bearer", evidence: "" });
    expect(auth?.type).toBe("bearer");
    const entries = auth?.["bearer"] as Array<{ key: string; value: string }>;
    expect(entries).toContainEqual({ key: "token", value: "{{token}}", type: "string" });
  });

  test("oauth2 produces clientCredentials with tokenUrl", () => {
    const auth = toPostmanAuth({ type: "oauth2", tokenUrl: "/oauth/token", evidence: "" });
    expect(auth?.type).toBe("oauth2");
    const entries = auth?.["oauth2"] as Array<{ key: string; value: string }>;
    expect(entries.some((e) => e.key === "grant_type" && e.value === "client_credentials")).toBe(true);
    expect(entries.some((e) => e.key === "accessTokenUrl")).toBe(true);
  });

  test("oauth2 with authorizeUrl adds the authUrl field", () => {
    const auth = toPostmanAuth({
      type: "oauth2",
      tokenUrl: "/oauth/token",
      authorizeUrl: "/oauth/authorize",
      evidence: "",
    });
    const entries = auth?.["oauth2"] as Array<{ key: string; value: string }>;
    expect(entries.some((e) => e.key === "authUrl" && e.value.includes("/oauth/authorize"))).toBe(true);
  });

  test("none returns null — no auth block", () => {
    expect(toPostmanAuth({ type: "none", evidence: "" })).toBeNull();
  });
});

describe("countKeyUsage — API-key casing (x00023)", () => {
  // x00023: the bug was that `header.set(h.key, …)` stored by the
  // original case of the first header. `X-API-Key` and `x-api-key`
  // in different endpoints ended up in two entries of 1 each and the
  // threshold of 2 was never reached. The fix accumulates by canonical
  // lowercase key and separately preserves the first original name as
  // `displayName`.

  test("[X-API-Key, x-api-key] counts 2 under 'x-api-key' and keeps 'X-API-Key' as displayName", () => {
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

  test("[x-api-key, X-API-KEY, X-Api-Key] merges into a single entry with count 3", () => {
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
    // The first name seen is kept as the displayName.
    expect(detected.keyName).toBe("x-api-key");
    expect(detected.evidence).toContain("aparece en 3 endpoints");
  });

  test("regression: two endpoints with mixed case confirm API-key auth (used to return 'none')", () => {
    // Before the fix, this scenario ended up with two entries of 1
    // (X-API-Key → 1, x-api-key → 1) and the detector concluded
    // 'none' because neither reached the threshold of 2.
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

  test("query: [api_key, API_KEY, Api_Key] merges into a single entry with count 3", () => {
    // Same pattern applied to query params: mixed case across
    // different endpoints counted as 1 each and never reached the
    // threshold.
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
