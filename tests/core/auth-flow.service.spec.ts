import { describe, expect, test, vi } from "vitest";

import { folder } from "../helpers/postman-builders";
import { applyAuthFlow, authEnvironmentVariables, detectAuthFlow, detectLaravelTokenPath, hasLoginEndpoint } from "../../packages/core/domain/auth-flow.service";
import { POSTMAN_SCHEMA_URL } from "../../packages/contracts/constants/core/postman.constant";
import type { PostmanCollection, PostmanItem } from "../../packages/contracts/interfaces/core/postman.interface";
import { AUTH_PASSWORD_VARIABLE, AUTH_TOKEN_VARIABLE, AUTH_USERNAME_VARIABLE } from "../../packages/contracts/constants/core/auth.constant";

function request(
  name: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): PostmanItem {
  return {
    name,
    request: {
      method,
      header: [],
      url: { raw: `{{baseUrl}}${path}`, host: ["{{baseUrl}}"], path: path.split("/").filter(Boolean) },
      ...(body
        ? { body: { mode: "raw" as const, raw: JSON.stringify(body, null, 2) } }
        : {}),
    },
  } as PostmanItem;
}

function collection(items: PostmanItem[]): PostmanCollection {
  return {
    info: { name: "API", description: "", schema: POSTMAN_SCHEMA_URL, _postman_id: "id" },
    variable: [],
    item: items,
  } as PostmanCollection;
}

const scriptOf = (item: PostmanItem | null) =>
  (item?.event ?? []).flatMap((e) => e.script.exec).join("\n");

const bodyOf = (item: PostmanItem | null) =>
  JSON.parse(item?.request?.body?.raw ?? "{}") as Record<string, unknown>;

describe("detectAuthFlow — detection by method + URI", () => {
  // The previous mechanism compared the item NAME against a list, and
  // the names the builder generates ("Create Login", "/POST auth/login")
  // never matched. That is why auto-token never activated in any
  // project.
  test.each([
    ["/auth/login", "POST"],
    ["/login", "POST"],
    ["/signin", "POST"],
    ["/sign-in", "POST"],
    ["/authenticate", "POST"],
    ["/auth/token", "POST"],
    ["/oauth/token", "POST"],
    ["/sessions", "POST"],
  ])("recognizes %s as login regardless of the item name", (path, method) => {
    const flow = detectAuthFlow(collection([request("Arbitrary Name", method, path)]));
    expect(flow?.login).not.toBeNull();
  });

  test("recognizes the refresh", () => {
    const flow = detectAuthFlow(collection([request("x", "POST", "/auth/refresh")]));
    expect(flow?.refresh).not.toBeNull();
    expect(flow?.login).toBeNull();
  });

  test("recognizes the logout with any of its methods", () => {
    for (const method of ["POST", "GET", "DELETE"]) {
      const flow = detectAuthFlow(collection([request("x", method, "/auth/logout")]));
      expect(flow?.logout).not.toBeNull();
    }
  });

  test("does not confuse a GET /login with the auth endpoint", () => {
    expect(detectAuthFlow(collection([request("x", "GET", "/login")]))).toBeNull();
  });

  test("does not flag as login an endpoint that only contains the word", () => {
    expect(detectAuthFlow(collection([request("x", "POST", "/login-attempts")]))).toBeNull();
  });

  test("looks inside nested folders", () => {
    const nested = folder("Auth", [folder("v1", [request("x", "POST", "/auth/login")])]);
    expect(detectAuthFlow(collection([nested]))?.login).not.toBeNull();
  });

  test("returns null for a collection without auth", () => {
    expect(detectAuthFlow(collection([request("x", "GET", "/users")]))).toBeNull();
  });

  test("ignores the query string when comparing", () => {
    const item = request("x", "POST", "/auth/login");
    item.request!.url.raw = "{{baseUrl}}/auth/login?redirect=/home";
    expect(detectAuthFlow(collection([item]))?.login).not.toBeNull();
  });
});

describe("applyAuthFlow — token capture", () => {
  test("login stores the token in the environment", () => {
    const c = collection([request("x", "POST", "/auth/login")]);
    const flow = applyAuthFlow(c);
    expect(scriptOf(flow?.login ?? null)).toContain(
      `pm.environment.set('${AUTH_TOKEN_VARIABLE}', token)`,
    );
  });

  test("falls back to collectionVariables if there is no active environment", () => {
    const c = collection([request("x", "POST", "/auth/login")]);
    expect(scriptOf(applyAuthFlow(c)?.login ?? null)).toContain(
      `pm.collectionVariables.set('${AUTH_TOKEN_VARIABLE}', token)`,
    );
  });

  // Previously `tokenResponsePath` had to be configured by hand, and
  // without it no script was generated at all.
  test("without tokenResponsePath tries the usual paths", () => {
    const script = scriptOf(applyAuthFlow(collection([request("x", "POST", "/auth/login")]))?.login ?? null);
    for (const path of ["access_token", "token", "data.access_token", "accessToken", "jwt"]) {
      expect(script).toContain(`"${path}"`);
    }
  });

  test("with a declared tokenResponsePath uses only that one", () => {
    const script = scriptOf(
      applyAuthFlow(collection([request("x", "POST", "/auth/login")]), {
        tokenResponsePath: "data.mi_token",
      })?.login ?? null,
    );
    expect(script).toContain('"data.mi_token"');
    expect(script).not.toContain('"access_token"');
  });

  test("the failure is visible: it uses pm.test, not a silent if", () => {
    const script = scriptOf(applyAuthFlow(collection([request("x", "POST", "/auth/login")]))?.login ?? null);
    expect(script).toContain("pm.test(");
    expect(script).toContain("Token not found");
  });

  test("the refresh also captures the token", () => {
    const c = collection([request("x", "POST", "/auth/refresh")]);
    expect(scriptOf(applyAuthFlow(c)?.refresh ?? null)).toContain("pm.environment.set");
  });

  test("the logout clears the token", () => {
    const c = collection([request("x", "POST", "/auth/logout")]);
    const script = scriptOf(applyAuthFlow(c)?.logout ?? null);
    expect(script).toContain(`pm.environment.set('${AUTH_TOKEN_VARIABLE}', '')`);
    expect(script).toContain(`pm.collectionVariables.set('${AUTH_TOKEN_VARIABLE}', '')`);
  });

  test("returns null and does not touch anything if there is no auth", () => {
    const c = collection([request("x", "GET", "/users")]);
    expect(applyAuthFlow(c)).toBeNull();
    expect(c.item[0]?.event).toBeUndefined();
  });
});

describe("applyAuthFlow — credentials body", () => {
  test("preserves the project's actual field names", () => {
    const c = collection([
      request("x", "POST", "/auth/login", { username: "demo", password: "1234" }),
    ]);
    const body = bodyOf(applyAuthFlow(c)?.login ?? null);
    expect(body).toEqual({
      username: `{{${AUTH_USERNAME_VARIABLE}}}`,
      password: `{{${AUTH_PASSWORD_VARIABLE}}}`,
    });
  });

  test("recognizes email as the user field", () => {
    const c = collection([
      request("x", "POST", "/auth/login", { email: "a@b.c", password: "1234" }),
    ]);
    expect(bodyOf(applyAuthFlow(c)?.login ?? null)["email"]).toBe(
      `{{${AUTH_USERNAME_VARIABLE}}}`,
    );
  });

  // `attachCredentialTemplate` no longer replaces an unknown body
  // with an invented one: it leaves the body intact and warns
  // (a00012 S3.b). The previous test (which did replace it) validated
  // the old behavior; we keep the intent —"an inferred body without
  // credentials must NOT contaminate what the builder produces"—but
  // the guarantee becomes "leaves it as-is" instead of "stomps on
  // it".
  test("preserves an inferred body without credentials and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = collection([
        request("x", "POST", "/auth/login", { force: false, notes: "Operación POST sobre auth" }),
      ]);
      const body = bodyOf(applyAuthFlow(c)?.login ?? null);
      // The original body is preserved AS-IS — no credentials that
      // were not there get injected, and fields that were there are
      // not removed.
      expect(body).toEqual({ force: false, notes: "Operación POST sobre auth" });
      // And the structured warning is emitted explaining why.
      expect(warn).toHaveBeenCalled();
      const payload = JSON.parse(warn.mock.calls[0]?.[0] as string) as {
        kind: string;
        reason: string;
        path: string;
        keys?: string[];
      };
      expect(payload.kind).toBe("missing-credentials");
      expect(payload.reason).toBe("no-credential-keys");
      expect(payload.path).toContain("/auth/login");
      expect(payload.keys).toContain("force");
      expect(payload.keys).toContain("notes");
    } finally {
      warn.mockRestore();
    }
  });

  test("preserves the empty login body and warns (does not invent one)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = collection([request("x", "POST", "/auth/login")]);
      const login = applyAuthFlow(c)?.login ?? null;
      // The body stays absent: no email/password body is invented.
      expect(login?.request?.body).toBeUndefined();
      // Structured warning in its place.
      const payload = JSON.parse(warn.mock.calls[0]?.[0] as string) as {
        kind: string;
        reason: string;
      };
      expect(payload.kind).toBe("missing-credentials");
      expect(payload.reason).toBe("no-json-body");
    } finally {
      warn.mockRestore();
    }
  });

  // Content-Type used to be added ALWAYS, because the old function
  // stomped the body with an invented one even without credentials.
  // `attachCredentialTemplate` (a00012 S3.b) only writes the body (and
  // therefore adds Content-Type) when it actually patches
  // credentials. We keep the intent —"when we write JSON, we mark the
  // Content-Type"—but limited to the case where credentials exist.
  test("adds Content-Type: application/json when it patches credentials", () => {
    const c = collection([
      request("x", "POST", "/auth/login", { username: "demo", password: "1234" }),
    ]);
    const headers = applyAuthFlow(c)?.login?.request?.header ?? [];
    expect(headers.some((h) => h.key === "Content-Type")).toBe(true);
  });

  test("does NOT add Content-Type when it leaves the body intact", () => {
    // If login had no credentials, no body is written and there is
    // no reason to add Content-Type.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = collection([
        request("x", "POST", "/auth/login", { force: false, notes: "x" }),
      ]);
      const headers = applyAuthFlow(c)?.login?.request?.header ?? [];
      expect(headers.some((h) => h.key === "Content-Type")).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  test("does not duplicate Content-Type if it was already there", () => {
    const item = request("x", "POST", "/auth/login");
    item.request!.header.push({ key: "Content-Type", value: "application/json" });
    const headers = applyAuthFlow(collection([item]))?.login?.request?.header ?? [];
    expect(headers.filter((h) => h.key === "Content-Type")).toHaveLength(1);
  });

  test("documents the flow in the login's description", () => {
    const c = collection([request("x", "POST", "/auth/login")]);
    const description = applyAuthFlow(c)?.login?.description ?? "";
    expect(description).toContain(AUTH_USERNAME_VARIABLE);
    expect(description).toContain(AUTH_PASSWORD_VARIABLE);
    expect(description).toContain("survives closing Postman");
  });
});

describe("applyAuthFlow — name-based fallback", () => {
  test("uses loginEndpointName when the URI is not conventional", () => {
    const c = collection([request("Mi Login Raro", "POST", "/acceso-empresa")]);
    const flow = applyAuthFlow(c, { loginEndpointName: "Mi Login Raro" });
    expect(flow?.login).not.toBeNull();
    expect(scriptOf(flow?.login ?? null)).toContain("pm.environment.set");
  });

  test("does not invent a login if the declared name does not exist", () => {
    const c = collection([request("Other", "POST", "/acceso-empresa")]);
    expect(applyAuthFlow(c, { loginEndpointName: "No Existe" })).toBeNull();
  });
});

describe("authEnvironmentVariables", () => {
  test("declares username, password and token", () => {
    expect(authEnvironmentVariables().map((v) => v.key)).toEqual([
      AUTH_USERNAME_VARIABLE,
      AUTH_PASSWORD_VARIABLE,
      AUTH_TOKEN_VARIABLE,
    ]);
  });

  test("marks them as secret so Postman does not export them in clear", () => {
    for (const v of authEnvironmentVariables()) expect(v.type).toBe("secret");
  });
});

describe("hasLoginEndpoint", () => {
  test("recognizes POST /login in the specs", () => {
    expect(hasLoginEndpoint([{ method: "POST", uri: "/login" }])).toBe(true);
  });

  test("GET /login does not count", () => {
    expect(hasLoginEndpoint([{ method: "GET", uri: "/login" }])).toBe(false);
  });

  test("without specs returns false", () => {
    expect(hasLoginEndpoint([])).toBe(false);
  });

  test("recognizes /sessions as a login endpoint", () => {
    expect(hasLoginEndpoint([{ method: "POST", uri: "/sessions" }])).toBe(true);
  });
});

describe("detectLaravelTokenPath", () => {
  test("without a Controllers directory returns undefined", async () => {
    const result = await detectLaravelTokenPath("/path/que/no/existe");
    expect(result).toBeUndefined();
  });

  test("with a Controllers directory but no auth controllers returns undefined", async () => {
    const { mkdtemp, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(join(tmpdir(), "laravel-test-"));
    await mkdir(join(root, "app/Http/Controllers"), { recursive: true });
    const result = await detectLaravelTokenPath(root);
    expect(result).toBeUndefined();
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });

  test("with an AuthController returning access_token detects it", async () => {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(join(tmpdir(), "laravel-test-"));
    await mkdir(join(root, "app/Http/Controllers"), { recursive: true });
    await writeFile(
      join(root, "app/Http/Controllers/AuthController.php"),
      `<?php\nreturn ['access_token' => $token];\n`,
    );
    const result = await detectLaravelTokenPath(root);
    expect(result).toBe("access_token");
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });

  test("with an AuthController returning data.token detects it", async () => {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(join(tmpdir(), "laravel-test-"));
    await mkdir(join(root, "app/Http/Controllers"), { recursive: true });
    await writeFile(
      join(root, "app/Http/Controllers/AuthController.php"),
      `<?php\nreturn ['data' => ['token' => $t]];\n`,
    );
    const result = await detectLaravelTokenPath(root);
    expect(result).toBe("data.token");
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });
});
