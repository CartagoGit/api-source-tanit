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

describe("detectAuthFlow — detección por método + URI", () => {
  // El mecanismo anterior comparaba el NOMBRE del item contra una lista,
  // y los nombres que genera el builder ("Crear Login", "/POST auth/login")
  // no casaban nunca. Por eso el auto-token no se activaba en ningún
  // proyecto.
  test.each([
    ["/auth/login", "POST"],
    ["/login", "POST"],
    ["/signin", "POST"],
    ["/sign-in", "POST"],
    ["/authenticate", "POST"],
    ["/auth/token", "POST"],
    ["/oauth/token", "POST"],
    ["/sessions", "POST"],
  ])("reconoce %s como login sea cual sea el nombre del item", (path, method) => {
    const flow = detectAuthFlow(collection([request("Nombre Arbitrario", method, path)]));
    expect(flow?.login).not.toBeNull();
  });

  test("reconoce el refresh", () => {
    const flow = detectAuthFlow(collection([request("x", "POST", "/auth/refresh")]));
    expect(flow?.refresh).not.toBeNull();
    expect(flow?.login).toBeNull();
  });

  test("reconoce el logout con cualquiera de sus métodos", () => {
    for (const method of ["POST", "GET", "DELETE"]) {
      const flow = detectAuthFlow(collection([request("x", method, "/auth/logout")]));
      expect(flow?.logout).not.toBeNull();
    }
  });

  test("no confunde un GET /login con el endpoint de autenticación", () => {
    expect(detectAuthFlow(collection([request("x", "GET", "/login")]))).toBeNull();
  });

  test("no marca como login un endpoint que solo contiene la palabra", () => {
    expect(detectAuthFlow(collection([request("x", "POST", "/login-attempts")]))).toBeNull();
  });

  test("busca dentro de carpetas anidadas", () => {
    const nested = folder("Auth", [folder("v1", [request("x", "POST", "/auth/login")])]);
    expect(detectAuthFlow(collection([nested]))?.login).not.toBeNull();
  });

  test("devuelve null en una colección sin auth", () => {
    expect(detectAuthFlow(collection([request("x", "GET", "/users")]))).toBeNull();
  });

  test("ignora la query string al comparar", () => {
    const item = request("x", "POST", "/auth/login");
    item.request!.url.raw = "{{baseUrl}}/auth/login?redirect=/home";
    expect(detectAuthFlow(collection([item]))?.login).not.toBeNull();
  });
});

describe("applyAuthFlow — captura del token", () => {
  test("el login guarda el token en el environment", () => {
    const c = collection([request("x", "POST", "/auth/login")]);
    const flow = applyAuthFlow(c);
    expect(scriptOf(flow?.login ?? null)).toContain(
      `pm.environment.set('${AUTH_TOKEN_VARIABLE}', token)`,
    );
  });

  test("cae a collectionVariables si no hay environment activo", () => {
    const c = collection([request("x", "POST", "/auth/login")]);
    expect(scriptOf(applyAuthFlow(c)?.login ?? null)).toContain(
      `pm.collectionVariables.set('${AUTH_TOKEN_VARIABLE}', token)`,
    );
  });

  // Antes se exigía `tokenResponsePath` configurado a mano y, sin él, no
  // se generaba script ninguno.
  test("sin tokenResponsePath prueba los caminos habituales", () => {
    const script = scriptOf(applyAuthFlow(collection([request("x", "POST", "/auth/login")]))?.login ?? null);
    for (const path of ["access_token", "token", "data.access_token", "accessToken", "jwt"]) {
      expect(script).toContain(`"${path}"`);
    }
  });

  test("con tokenResponsePath declarado usa solo ese", () => {
    const script = scriptOf(
      applyAuthFlow(collection([request("x", "POST", "/auth/login")]), {
        tokenResponsePath: "data.mi_token",
      })?.login ?? null,
    );
    expect(script).toContain('"data.mi_token"');
    expect(script).not.toContain('"access_token"');
  });

  test("el fallo es visible: usa pm.test, no un if silencioso", () => {
    const script = scriptOf(applyAuthFlow(collection([request("x", "POST", "/auth/login")]))?.login ?? null);
    expect(script).toContain("pm.test(");
    expect(script).toContain("Token not found");
  });

  test("el refresh también captura el token", () => {
    const c = collection([request("x", "POST", "/auth/refresh")]);
    expect(scriptOf(applyAuthFlow(c)?.refresh ?? null)).toContain("pm.environment.set");
  });

  test("el logout limpia el token", () => {
    const c = collection([request("x", "POST", "/auth/logout")]);
    const script = scriptOf(applyAuthFlow(c)?.logout ?? null);
    expect(script).toContain(`pm.environment.set('${AUTH_TOKEN_VARIABLE}', '')`);
    expect(script).toContain(`pm.collectionVariables.set('${AUTH_TOKEN_VARIABLE}', '')`);
  });

  test("devuelve null y no toca nada si no hay auth", () => {
    const c = collection([request("x", "GET", "/users")]);
    expect(applyAuthFlow(c)).toBeNull();
    expect(c.item[0]?.event).toBeUndefined();
  });
});

describe("applyAuthFlow — body de credenciales", () => {
  test("conserva los nombres de campo reales del proyecto", () => {
    const c = collection([
      request("x", "POST", "/auth/login", { username: "demo", password: "1234" }),
    ]);
    const body = bodyOf(applyAuthFlow(c)?.login ?? null);
    expect(body).toEqual({
      username: `{{${AUTH_USERNAME_VARIABLE}}}`,
      password: `{{${AUTH_PASSWORD_VARIABLE}}}`,
    });
  });

  test("reconoce email como campo de usuario", () => {
    const c = collection([
      request("x", "POST", "/auth/login", { email: "a@b.c", password: "1234" }),
    ]);
    expect(bodyOf(applyAuthFlow(c)?.login ?? null)["email"]).toBe(
      `{{${AUTH_USERNAME_VARIABLE}}}`,
    );
  });

  // `attachCredentialTemplate` ya no sustituye un body desconocido
  // por uno inventado: deja el body intacto y avisa (a00012 S3.b).
  // El test anterior (que sí lo sustituía) validaba el comportamiento
  // viejo; mantenemos la intención —"un body inferido sin credenciales
  // NO debe contaminar el que arma el builder"—, pero la garantía pasa
  // a ser "lo deja como está" en lugar de "lo machaca".
  test("preserva un body inferido sin credenciales y avisa", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = collection([
        request("x", "POST", "/auth/login", { force: false, notes: "Operación POST sobre auth" }),
      ]);
      const body = bodyOf(applyAuthFlow(c)?.login ?? null);
      // El body original se conserva TAL CUAL —no se inyectan credenciales
      // que no estaban, ni se borran los campos que sí estaban.
      expect(body).toEqual({ force: false, notes: "Operación POST sobre auth" });
      // Y se emite el aviso estructurado explicando por qué.
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

  test("preserva el body vacío del login y avisa (no crea uno inventado)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = collection([request("x", "POST", "/auth/login")]);
      const login = applyAuthFlow(c)?.login ?? null;
      // El body sigue ausente: no se inventa uno con email/password.
      expect(login?.request?.body).toBeUndefined();
      // Aviso estructurado en su lugar.
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

  // Antes se añadía Content-Type SIEMPRE, porque la función vieja
  // machacaba el body con uno inventado aunque no hubiera credenciales.
  // `attachCredentialTemplate` (a00012 S3.b) sólo escribe el body (y por
  // tanto añade Content-Type) cuando realmente parchea credenciales.
  // Mantenemos la intención —"cuando escribimos JSON, marcamos el
  // Content-Type"—, pero limitada al caso en que hay credenciales.
  test("añade Content-Type: application/json cuando parchea credenciales", () => {
    const c = collection([
      request("x", "POST", "/auth/login", { username: "demo", password: "1234" }),
    ]);
    const headers = applyAuthFlow(c)?.login?.request?.header ?? [];
    expect(headers.some((h) => h.key === "Content-Type")).toBe(true);
  });

  test("NO añade Content-Type cuando deja el body intacto", () => {
    // Si el login no traía credenciales, no se escribe body y por
    // tanto no hay razón para añadir Content-Type.
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

  test("no duplica el Content-Type si ya estaba", () => {
    const item = request("x", "POST", "/auth/login");
    item.request!.header.push({ key: "Content-Type", value: "application/json" });
    const headers = applyAuthFlow(collection([item]))?.login?.request?.header ?? [];
    expect(headers.filter((h) => h.key === "Content-Type")).toHaveLength(1);
  });

  test("documenta el flujo en la descripción del login", () => {
    const c = collection([request("x", "POST", "/auth/login")]);
    const description = applyAuthFlow(c)?.login?.description ?? "";
    expect(description).toContain(AUTH_USERNAME_VARIABLE);
    expect(description).toContain(AUTH_PASSWORD_VARIABLE);
    expect(description).toContain("survives closing Postman");
  });
});

describe("applyAuthFlow — fallback por nombre", () => {
  test("usa loginEndpointName cuando la URI no es convencional", () => {
    const c = collection([request("Mi Login Raro", "POST", "/acceso-empresa")]);
    const flow = applyAuthFlow(c, { loginEndpointName: "Mi Login Raro" });
    expect(flow?.login).not.toBeNull();
    expect(scriptOf(flow?.login ?? null)).toContain("pm.environment.set");
  });

  test("no inventa un login si el nombre declarado no existe", () => {
    const c = collection([request("Otro", "POST", "/acceso-empresa")]);
    expect(applyAuthFlow(c, { loginEndpointName: "No Existe" })).toBeNull();
  });
});

describe("authEnvironmentVariables", () => {
  test("declara usuario, contraseña y token", () => {
    expect(authEnvironmentVariables().map((v) => v.key)).toEqual([
      AUTH_USERNAME_VARIABLE,
      AUTH_PASSWORD_VARIABLE,
      AUTH_TOKEN_VARIABLE,
    ]);
  });

  test("las marca como secret para que Postman no las exporte en claro", () => {
    for (const v of authEnvironmentVariables()) expect(v.type).toBe("secret");
  });
});

describe("hasLoginEndpoint", () => {
  test("reconoce POST /login en los specs", () => {
    expect(hasLoginEndpoint([{ method: "POST", uri: "/login" }])).toBe(true);
  });

  test("GET /login no cuenta", () => {
    expect(hasLoginEndpoint([{ method: "GET", uri: "/login" }])).toBe(false);
  });

  test("sin specs devuelve false", () => {
    expect(hasLoginEndpoint([])).toBe(false);
  });

  test("reconoce /sessions como login endpoint", () => {
    expect(hasLoginEndpoint([{ method: "POST", uri: "/sessions" }])).toBe(true);
  });
});

describe("detectLaravelTokenPath", () => {
  test("sin directorio Controllers devuelve undefined", async () => {
    const result = await detectLaravelTokenPath("/ruta/que/no/existe");
    expect(result).toBeUndefined();
  });

  test("con directorio Controllers pero sin auth controllers devuelve undefined", async () => {
    const { mkdtemp, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(join(tmpdir(), "laravel-test-"));
    await mkdir(join(root, "app/Http/Controllers"), { recursive: true });
    const result = await detectLaravelTokenPath(root);
    expect(result).toBeUndefined();
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });

  test("con AuthController que devuelve access_token lo detecta", async () => {
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

  test("con AuthController que devuelve data.token lo detecta", async () => {
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
