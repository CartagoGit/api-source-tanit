/**
 * a00012 S3.b — Login body preservado.
 *
 * `useCredentialVariables` (la versión vieja) tenía un caso
 * destructivo: cuando el body del login no exponía `username`,
 * `email` o `password` como claves, machacaba el body entero con un
 * par inventado. Eso rompía:
 *
 *   - Logins OAuth2 con `grant_type` + `client_id` + `client_secret`
 *     (no son credenciales de usuario, pero el body real debe
 *     sobrevivir).
 *   - Flujos OTP que llevan `phone` + `code` en lugar de password.
 *   - Endpoints de tenant/apiKey con campos que el scanner sí
 *     reconoció y que perderían sus nombres al sobreescribir.
 *
 * `attachCredentialTemplate` es estricto: sólo parchea claves que ya
 * están en el body y que valen `string`. Si no encuentra credenciales,
 * deja el body intacto y avisa con `warnMissingCredentials`.
 *
 * Estos tests son la garantía: con un body que no es credencial, el
 * body original se conserva byte-a-byte y el aviso estructurado sale
 * por `console.warn` con la forma canónica.
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

describe("login-body-preserve — attachCredentialTemplate no reemplaza bodies ajenos (a00012 S3.b)", () => {
  test("body OAuth2 client_credentials se conserva intacto y avisa", () => {
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

      // El body original se conserva byte-a-byte. NO se sustituye por
      // {email: "...", password: "..."} como hacía useCredentialVariables.
      expect(resultingBody).toEqual(originalBody);
      expect(resultingBody?.grant_type).toBe("password");
      expect(resultingBody?.client_id).toBe("x");
      expect(resultingBody?.client_secret).toBe("y");

      // Y sale el aviso estructurado explicando por qué no se parchó.
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

  test("body con campos extra al lado de credenciales se conserva parcialmente", () => {
    // Si el body lleva `username`/`password` Y campos extra del
    // proyecto (p. ej. `tenant` o `remember_me`), las credenciales se
    // parchean y lo demás se queda.
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
      // No se emitió aviso: las credenciales estaban.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("campos de credencial con valor no-string NO se tocan y avisa", () => {
    // Si el scanner rellenó `email: 1` (un placeholder numérico) no es
    // un valor de credencial: se respeta. Como consecuencia, falta
    // una credencial de usuario válida y el body entero queda intacto
    // con aviso estructurado.
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

      // email: 1 no es string → se queda como está.
      expect(resultingBody?.email).toBe(1);
      // password sigue siendo el valor del scanner: como `email` no
      // califica como credencial, NO se toca nada del body.
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

describe("warnMissingCredentials — aviso estructurado (a00012 S3.b)", () => {
  test("emite JSON parseable con la forma canónica", () => {
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

  test("acepta `reason: no-json-body` sin `keys`", () => {
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