/**
 * a00012 S3.b — Login body preserved.
 *
 * `useCredentialVariables` (the old version) had a destructive case:
 * when the login body did not expose `username`, `email` or `password`
 * as keys, it overwrote the entire body with an invented pair. That
 * broke:
 *
 *   - OAuth2 logins with `grant_type` + `client_id` + `client_secret`
 *     (they are not user credentials, but the real body must survive).
 *   - OTP flows that carry `phone` + `code` instead of password.
 *   - Tenant/apiKey endpoints with fields the scanner did recognize
 *     and which would lose their names when overwritten.
 *
 * `attachCredentialTemplate` is strict: it only patches keys that are
 * already in the body and that are `string`. If it finds no
 * credentials, it leaves the body intact and warns via
 * `warnMissingCredentials`.
 *
 * These tests are the guarantee: with a body that is not a credential,
 * the original body is preserved byte-for-byte and the structured
 * warning goes out through `console.warn` in its canonical shape.
 */
import { describe, expect, test, vi } from "vitest";

import {
  applyAuthFlow,
  warnMissingCredentials,
} from "../../packages/core/domain/auth-flow.service";
import { POSTMAN_SCHEMA_URL } from "../../packages/contracts/constants/core/postman.constant";
import type {
  PostmanCollection,
  PostmanItem,
} from "../../packages/contracts/interfaces/core/postman.interface";

function loginWithBody(body: Record<string, unknown>): PostmanItem {
  return {
    name: "Login",
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json", type: "text" }],
      url: {
        raw: "{{baseUrl}}/oauth/token",
        host: ["{{baseUrl}}"],
        path: ["oauth", "token"],
      },
      body: {
        mode: "raw",
        raw: JSON.stringify(body, null, 2),
        options: { raw: { language: "json" } },
      },
    },
  };
}

function collectionWithLogin(login: PostmanItem): PostmanCollection {
  return {
    info: {
      name: "OAuth2",
      description: "",
      schema: POSTMAN_SCHEMA_URL,
      _postman_id: "id",
    },
    variable: [],
    item: [login],
  };
}

function bodyOf(item: PostmanItem | null): Record<string, unknown> | undefined {
  if (!item?.request?.body?.raw) return undefined;
  return JSON.parse(item.request.body.raw) as Record<string, unknown>;
}

describe("login-body-preserve — attachCredentialTemplate does not replace foreign bodies (a00012 S3.b)", () => {
  test("an OAuth2 client_credentials body is preserved intact and a warning is emitted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const originalBody = {
        grant_type: "password",
        client_id: "x",
        client_secret: "y",
      };
      const login = loginWithBody(originalBody);
      const col = collectionWithLogin(login);

      const flow = applyAuthFlow(col);
      const resultingBody = bodyOf(flow?.login ?? null);

      // The original body is preserved byte-for-byte. It is NOT
      // replaced by {email: "...", password: "..."} as
      // useCredentialVariables used to do.
      expect(resultingBody).toEqual(originalBody);
      expect(resultingBody?.grant_type).toBe("password");
      expect(resultingBody?.client_id).toBe("x");
      expect(resultingBody?.client_secret).toBe("y");

      // And the structured warning comes out explaining why nothing
      // was patched.
      expect(warn).toHaveBeenCalled();
      const payload = JSON.parse(warn.mock.calls[0]?.[0] as string) as {
        kind: string;
        reason: string;
        path: string;
        keys?: string[];
      };
      expect(payload.kind).toBe("missing-credentials");
      expect(payload.reason).toBe("no-credential-keys");
      expect(payload.path).toContain("/oauth/token");
      expect(payload.keys).toContain("grant_type");
      expect(payload.keys).toContain("client_id");
      expect(payload.keys).toContain("client_secret");
    } finally {
      warn.mockRestore();
    }
  });

  test("a body with extra fields next to credentials is partially preserved", () => {
    // If the body carries `username`/`password` AND project extra
    // fields (e.g. `tenant` or `remember_me`), the credentials are
    // patched and the rest stays.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const originalBody = {
        username: "demo",
        password: "1234",
        tenant: "acme",
        remember_me: true,
      };
      const login = loginWithBody(originalBody);
      const col = collectionWithLogin(login);

      const flow = applyAuthFlow(col);
      const resultingBody = bodyOf(flow?.login ?? null);

      expect(resultingBody?.username).toBe("{{authUsername}}");
      expect(resultingBody?.password).toBe("{{authPassword}}");
      expect(resultingBody?.tenant).toBe("acme");
      expect(resultingBody?.remember_me).toBe(true);
      // No warning emitted: the credentials were there.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("credential fields with non-string values are NOT touched and a warning is emitted", () => {
    // If the scanner filled `email: 1` (a numeric placeholder) it is
    // not a credential value: it is respected. As a consequence, a
    // valid user credential is missing and the whole body stays
    // intact with a structured warning.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const originalBody = {
        email: 1,
        password: "1234",
      };
      const login = loginWithBody(originalBody);
      const col = collectionWithLogin(login);

      const flow = applyAuthFlow(col);
      const resultingBody = bodyOf(flow?.login ?? null);

      // email: 1 is not a string → it stays as-is.
      expect(resultingBody?.email).toBe(1);
      // password stays as the scanner's value: since `email` does not
      // qualify as a credential, NOTHING in the body is touched.
      expect(resultingBody?.password).toBe("1234");
      const payload = JSON.parse(warn.mock.calls[0]?.[0] as string) as {
        kind: string;
        reason: string;
        keys?: string[];
      };
      expect(payload.kind).toBe("missing-credentials");
      expect(payload.reason).toBe("no-credential-keys");
      expect(payload.keys).toEqual(["email", "password"]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("warnMissingCredentials — structured warning (a00012 S3.b)", () => {
  test("emits parseable JSON with the canonical shape", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      warnMissingCredentials({
        reason: "no-credential-keys",
        path: "/auth/login",
        keys: ["grant_type", "client_id"],
      });
      const call = warn.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(call) as {
        kind: string;
        reason: string;
        path: string;
        keys: string[];
      };
      expect(parsed.kind).toBe("missing-credentials");
      expect(parsed.reason).toBe("no-credential-keys");
      expect(parsed.path).toBe("/auth/login");
      expect(parsed.keys).toEqual(["grant_type", "client_id"]);
    } finally {
      warn.mockRestore();
    }
  });

  test("accepts `reason: no-json-body` without `keys`", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      warnMissingCredentials({
        reason: "no-json-body",
        path: "/auth/login",
      });
      const parsed = JSON.parse(warn.mock.calls[0]?.[0] as string) as {
        kind: string;
        reason: string;
        path: string;
      };
      expect(parsed.kind).toBe("missing-credentials");
      expect(parsed.reason).toBe("no-json-body");
      expect(parsed.path).toBe("/auth/login");
      expect("keys" in parsed).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});