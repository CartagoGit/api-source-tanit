import { describe, expect, test } from "vitest";
import { buildEnvironment, buildEnvironments, defaultEnvironments } from "../../packages/core/domain/environment-builder.service";
import type { EndpointSpec, PostmanVariable } from "../../packages/contracts/interfaces/core/postman.interface";

const VARIABLES: PostmanVariable[] = [
  { key: "baseUrl", value: "http://localhost/api", type: "string" },
  { key: "token", value: "", type: "string" },
];

const spec = (uri: string): EndpointSpec =>
  ({ name: uri, method: "GET", uri, headers: [], query: [] }) as EndpointSpec;

describe("buildEnvironment", () => {
  test("incluye todas las variables recibidas", () => {
    const env = buildEnvironment("Local", VARIABLES);
    expect(env.values.map((v) => v.key)).toEqual(["baseUrl", "token"]);
  });

  test("los overrides ganan al valor base", () => {
    const env = buildEnvironment("Prod", VARIABLES, {
      baseUrl: "https://api.example.com",
    });
    expect(env.values.find((v) => v.key === "baseUrl")?.value).toBe(
      "https://api.example.com",
    );
  });

  test("un override de una variable inexistente se ignora", () => {
    const env = buildEnvironment("Local", VARIABLES, { noExiste: "x" });
    expect(env.values.map((v) => v.key)).toEqual(["baseUrl", "token"]);
  });

  // Postman no exporta las variables marcadas como secret, que es lo que
  // evita que un token acabe compartido por accidente.
  test("marca como secret el token y todo lo que huela a credencial", () => {
    const env = buildEnvironment("Local", [
      ...VARIABLES,
      { key: "apiKey", value: "", type: "string" },
      { key: "userPassword", value: "", type: "string" },
      { key: "clientSecret", value: "", type: "string" },
    ]);
    const typeOf = (key: string) => env.values.find((v) => v.key === key)?.type;
    expect(typeOf("token")).toBe("secret");
    expect(typeOf("apiKey")).toBe("secret");
    expect(typeOf("userPassword")).toBe("secret");
    expect(typeOf("clientSecret")).toBe("secret");
  });

  test("baseUrl no es secret", () => {
    expect(
      buildEnvironment("Local", VARIABLES).values.find((v) => v.key === "baseUrl")?.type,
    ).toBe("default");
  });

  test("todas las variables llegan habilitadas", () => {
    for (const value of buildEnvironment("Local", VARIABLES).values) {
      expect(value.enabled).toBe(true);
    }
  });

  test("respeta el nombre y el scope", () => {
    const env = buildEnvironment("Staging", VARIABLES);
    expect(env.name).toBe("Staging");
    expect(env.scope).toBe("environment");
  });

  test("el color es opcional", () => {
    expect(buildEnvironment("Local", VARIABLES).color).toBeUndefined();
    expect(buildEnvironment("Local", VARIABLES, {}, "#FF0000").color).toBe("#FF0000");
  });

  // p00014: un id aleatorio hace que cada import cree un environment
  // nuevo en lugar de actualizar el existente.
  test("el id es determinista para la misma colección y entorno", () => {
    const a = buildEnvironment("Local", VARIABLES, {}, undefined, "col-1");
    const b = buildEnvironment("Local", VARIABLES, {}, undefined, "col-1");
    expect(a.id).toBe(b.id);
    expect(a._postman_id).toBe(a.id);
  });

  test("dos entornos de la misma colección tienen ids distintos", () => {
    const local = buildEnvironment("Local", VARIABLES, {}, undefined, "col-1");
    const prod = buildEnvironment("Prod", VARIABLES, {}, undefined, "col-1");
    expect(local.id).not.toBe(prod.id);
  });

  test("el mismo entorno en colecciones distintas no colisiona", () => {
    const a = buildEnvironment("Local", VARIABLES, {}, undefined, "col-1");
    const b = buildEnvironment("Local", VARIABLES, {}, undefined, "col-2");
    expect(a.id).not.toBe(b.id);
  });
});

describe("buildEnvironments", () => {
  test("produce un environment por definición", () => {
    const envs = buildEnvironments([], VARIABLES, [
      { name: "Local", overrides: {} },
      { name: "Prod", overrides: {} },
    ]);
    expect(envs.map((e) => e.name)).toEqual(["Local", "Prod"]);
  });

  test("sin definiciones devuelve []", () => {
    expect(buildEnvironments([], VARIABLES, [])).toEqual([]);
  });

  test("añade las variables de path que usan los endpoints", () => {
    const envs = buildEnvironments(
      [spec("/users/{{id}}")],
      VARIABLES,
      [{ name: "Local", overrides: {} }],
    );
    expect(envs[0]?.values.map((v) => v.key)).toContain("id");
  });

  test("no duplica una variable de path ya declarada", () => {
    const envs = buildEnvironments(
      [spec("/users/{{id}}")],
      [...VARIABLES, { key: "id", value: "42", type: "string" }],
      [{ name: "Local", overrides: {} }],
    );
    const ids = envs[0]?.values.filter((v) => v.key === "id") ?? [];
    expect(ids).toHaveLength(1);
    expect(ids[0]?.value).toBe("42");
  });

  test("propaga el id de colección a todos los entornos", () => {
    const envs = buildEnvironments([], VARIABLES, [
      { name: "Local", overrides: {} },
      { name: "Prod", overrides: {} },
    ], "col-1");
    expect(new Set(envs.map((e) => e.id)).size).toBe(2);
  });
});

describe("defaultEnvironments", () => {
  test("propone los cuatro entornos habituales", () => {
    expect(defaultEnvironments("https://api.example.com").map((e) => e.name)).toEqual([
      "Local",
      "Dev",
      "Staging",
      "Production",
    ]);
  });

  test("Producción conserva la baseUrl tal cual", () => {
    const envs = defaultEnvironments("https://api.example.com");
    expect(envs.find((e) => e.name === "Production")?.overrides?.["baseUrl"]).toBe(
      "https://api.example.com",
    );
  });

  test("Dev y Staging prefijan el subdominio", () => {
    const envs = defaultEnvironments("https://api.example.com");
    expect(envs.find((e) => e.name === "Dev")?.overrides?.["baseUrl"]).toContain("//dev.");
    expect(envs.find((e) => e.name === "Staging")?.overrides?.["baseUrl"]).toContain(
      "//staging.",
    );
  });

  test("Local conserva el puerto y el path", () => {
    const envs = defaultEnvironments("http://localhost:8000/api");
    expect(envs.find((e) => e.name === "Local")?.overrides?.["baseUrl"]).toBe(
      "http://localhost:8000/api",
    );
  });

  test("cada entorno trae su color", () => {
    for (const env of defaultEnvironments("https://api.example.com")) {
      expect(env.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe("buildEnvironments — inferencia de valores de path variables", () => {
  function envVars(uri: string) {
    return buildEnvironments([spec(uri)], [], [{ name: "Local", overrides: {} }])[0]?.values ?? [];
  }
  const valueOf = (vars: ReturnType<typeof envVars>, key: string) =>
    vars.find((v) => v.key === key)?.value;

  test("{{email}} recibe un ejemplo de correo", () => {
    expect(valueOf(envVars("/users/{{userEmail}}"), "userEmail")).toBe("user@example.com");
  });

  test("{{uuid}} recibe un UUID de ejemplo", () => {
    expect(valueOf(envVars("/orders/{{orderId_uuid}}"), "orderId_uuid")).toMatch(
      /^00000000-0000-0000-0000-/,
    );
  });

  test("{{codigo}} recibe un código de ejemplo", () => {
    expect(valueOf(envVars("/items/{{codigo}}"), "codigo")).toBe("COD001");
  });

  test("{{matricula}} recibe un valor de ejemplo", () => {
    expect(valueOf(envVars("/vehiculos/{{matricula}}"), "matricula")).toBe("1234ABC");
  });

  test("{{url}} recibe una URL de ejemplo", () => {
    expect(valueOf(envVars("/proxy/{{targetUrl}}"), "targetUrl")).toBe("https://example.com");
  });

  test("{{date}} recibe una fecha de ejemplo", () => {
    expect(valueOf(envVars("/reports/{{date}}"), "date")).toBe("2024-01-15");
  });

  test("{{fecha}} también recibe una fecha (alias en español)", () => {
    expect(valueOf(envVars("/facturas/{{fecha}}"), "fecha")).toBe("2024-01-15");
  });

  test("una variable sin patrón especial recibe '1'", () => {
    expect(valueOf(envVars("/items/{{itemId}}"), "itemId")).toBe("1");
  });

  test("config con value vacío toma el ejemplo inferido", () => {
    const envs = buildEnvironments(
      [spec("/users/{{id}}")],
      [{ key: "id", value: "", type: "string" }],
      [{ name: "Local", overrides: {} }],
    );
    const idVar = envs[0]?.values.find((v) => v.key === "id");
    expect(idVar?.value).toBe("1");
  });
});
