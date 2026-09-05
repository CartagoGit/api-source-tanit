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
  test("includes all received variables", () => {
    const env = buildEnvironment("Local", VARIABLES);
    expect(env.values.map((v) => v.key)).toEqual(["baseUrl", "token"]);
  });

  test("overrides win over the base value", () => {
    const env = buildEnvironment("Prod", VARIABLES, {
      baseUrl: "https://api.example.com",
    });
    expect(env.values.find((v) => v.key === "baseUrl")?.value).toBe(
      "https://api.example.com",
    );
  });

  test("an override for a non-existent variable is ignored", () => {
    const env = buildEnvironment("Local", VARIABLES, { noExiste: "x" });
    expect(env.values.map((v) => v.key)).toEqual(["baseUrl", "token"]);
  });

  // Postman does not export variables marked as secret, which is what
  // keeps a token from being shared by accident.
  test("marks the token and anything that smells like a credential as secret", () => {
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

  test("baseUrl is not secret", () => {
    expect(
      buildEnvironment("Local", VARIABLES).values.find((v) => v.key === "baseUrl")?.type,
    ).toBe("default");
  });

  test("all variables arrive enabled", () => {
    for (const value of buildEnvironment("Local", VARIABLES).values) {
      expect(value.enabled).toBe(true);
    }
  });

  test("respects the name and the scope", () => {
    const env = buildEnvironment("Staging", VARIABLES);
    expect(env.name).toBe("Staging");
    expect(env.scope).toBe("environment");
  });

  test("color is optional", () => {
    expect(buildEnvironment("Local", VARIABLES).color).toBeUndefined();
    expect(buildEnvironment("Local", VARIABLES, {}, "#FF0000").color).toBe("#FF0000");
  });

  // p00014: a random id makes each import create a new environment
  // instead of updating the existing one.
  test("the id is deterministic for the same collection and environment", () => {
    const a = buildEnvironment("Local", VARIABLES, {}, undefined, "col-1");
    const b = buildEnvironment("Local", VARIABLES, {}, undefined, "col-1");
    expect(a.id).toBe(b.id);
    expect(a._postman_id).toBe(a.id);
  });

  test("two environments of the same collection have different ids", () => {
    const local = buildEnvironment("Local", VARIABLES, {}, undefined, "col-1");
    const prod = buildEnvironment("Prod", VARIABLES, {}, undefined, "col-1");
    expect(local.id).not.toBe(prod.id);
  });

  test("the same environment across different collections does not collide", () => {
    const a = buildEnvironment("Local", VARIABLES, {}, undefined, "col-1");
    const b = buildEnvironment("Local", VARIABLES, {}, undefined, "col-2");
    expect(a.id).not.toBe(b.id);
  });
});

describe("buildEnvironments", () => {
  test("produces one environment per definition", () => {
    const envs = buildEnvironments([], VARIABLES, [
      { name: "Local", overrides: {} },
      { name: "Prod", overrides: {} },
    ]);
    expect(envs.map((e) => e.name)).toEqual(["Local", "Prod"]);
  });

  test("with no definitions returns []", () => {
    expect(buildEnvironments([], VARIABLES, [])).toEqual([]);
  });

  test("adds the path variables used by the endpoints", () => {
    const envs = buildEnvironments(
      [spec("/users/{{id}}")],
      VARIABLES,
      [{ name: "Local", overrides: {} }],
    );
    expect(envs[0]?.values.map((v) => v.key)).toContain("id");
  });

  test("does not duplicate a path variable already declared", () => {
    const envs = buildEnvironments(
      [spec("/users/{{id}}")],
      [...VARIABLES, { key: "id", value: "42", type: "string" }],
      [{ name: "Local", overrides: {} }],
    );
    const ids = envs[0]?.values.filter((v) => v.key === "id") ?? [];
    expect(ids).toHaveLength(1);
    expect(ids[0]?.value).toBe("42");
  });

  test("propagates the collection id to all environments", () => {
    const envs = buildEnvironments([], VARIABLES, [
      { name: "Local", overrides: {} },
      { name: "Prod", overrides: {} },
    ], "col-1");
    expect(new Set(envs.map((e) => e.id)).size).toBe(2);
  });
});

describe("defaultEnvironments", () => {
  test("proposes the four usual environments", () => {
    expect(defaultEnvironments("https://api.example.com").map((e) => e.name)).toEqual([
      "Local",
      "Dev",
      "Staging",
      "Production",
    ]);
  });

  test("Production keeps the baseUrl as-is", () => {
    const envs = defaultEnvironments("https://api.example.com");
    expect(envs.find((e) => e.name === "Production")?.overrides?.["baseUrl"]).toBe(
      "https://api.example.com",
    );
  });

  test("Dev and Staging prefix the subdomain", () => {
    const envs = defaultEnvironments("https://api.example.com");
    expect(envs.find((e) => e.name === "Dev")?.overrides?.["baseUrl"]).toContain("//dev.");
    expect(envs.find((e) => e.name === "Staging")?.overrides?.["baseUrl"]).toContain(
      "//staging.",
    );
  });

  test("Local keeps the port and path", () => {
    const envs = defaultEnvironments("http://localhost:8000/api");
    expect(envs.find((e) => e.name === "Local")?.overrides?.["baseUrl"]).toBe(
      "http://localhost:8000/api",
    );
  });

  test("each environment carries its color", () => {
    for (const env of defaultEnvironments("https://api.example.com")) {
      expect(env.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe("buildEnvironments — path variable value inference", () => {
  function envVars(uri: string) {
    return buildEnvironments([spec(uri)], [], [{ name: "Local", overrides: {} }])[0]?.values ?? [];
  }
  const valueOf = (vars: ReturnType<typeof envVars>, key: string) =>
    vars.find((v) => v.key === key)?.value;

  test("{{email}} gets an email example", () => {
    expect(valueOf(envVars("/users/{{userEmail}}"), "userEmail")).toBe("user@example.com");
  });

  test("{{uuid}} gets a UUID example", () => {
    expect(valueOf(envVars("/orders/{{orderId_uuid}}"), "orderId_uuid")).toMatch(
      /^00000000-0000-0000-0000-/,
    );
  });

  test("{{codigo}} gets a code example", () => {
    expect(valueOf(envVars("/items/{{codigo}}"), "codigo")).toBe("COD001");
  });

  test("{{matricula}} gets an example value", () => {
    expect(valueOf(envVars("/vehiculos/{{matricula}}"), "matricula")).toBe("1234ABC");
  });

  test("{{url}} gets a URL example", () => {
    expect(valueOf(envVars("/proxy/{{targetUrl}}"), "targetUrl")).toBe("https://example.com");
  });

  test("{{date}} gets a date example", () => {
    expect(valueOf(envVars("/reports/{{date}}"), "date")).toBe("2024-01-15");
  });

  test("{{fecha}} also gets a date (Spanish alias)", () => {
    expect(valueOf(envVars("/facturas/{{fecha}}"), "fecha")).toBe("2024-01-15");
  });

  test("a variable with no special pattern gets '1'", () => {
    expect(valueOf(envVars("/items/{{itemId}}"), "itemId")).toBe("1");
  });

  test("a config with an empty value takes the inferred example", () => {
    const envs = buildEnvironments(
      [spec("/users/{{id}}")],
      [{ key: "id", value: "", type: "string" }],
      [{ name: "Local", overrides: {} }],
    );
    const idVar = envs[0]?.values.find((v) => v.key === "id");
    expect(idVar?.value).toBe("1");
  });
});
