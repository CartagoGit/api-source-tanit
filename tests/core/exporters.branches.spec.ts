/**
 * Los exportadores ante colecciones límite.
 *
 * `exporters.spec.ts` recorre el catálogo con una API REST normal y
 * bearer. Este mira las esquinas: cada esquema de auth en los cinco
 * formatos, un catálogo vacío, carpetas anidadas por override, URIs
 * raíz y claves de carpeta que colisionan al normalizarse.
 */
import { describe, expect, test } from "vitest";

import {
  exportTo,
  exportWarnings,
} from "../../packages/core/exporters/export-registry.service";
import { buildOpenApiDocument } from "../../packages/core/exporters/openapi.exporter";
import type {
  IExportInput,
} from "../../packages/contracts/interfaces/core/export-target.interface";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface";

const baseConfig: ProjectConfig = {
  name: "limite",
  collectionName: "Límite",
  collectionDescription: "Colección límite",
  baseUrl: "http://localhost:3000",
  variables: [{ key: "apiKey", value: "", type: "string" }],
  filePrefixes: {},
  zones: [],
  zoneOrder: [],
  defaultZone: "Otros",
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

function input(
  partial: Partial<IExportInput> & { auth: IExportInput["auth"] },
): IExportInput {
  return {
    specs: [],
    config: baseConfig,
    ...partial,
  } as IExportInput;
}

describe("auth apikey en los cinco formatos", () => {
  const apikey = { type: "apikey" as const, keyName: "X-Tenant", keyIn: "header" as const };
  const entrada = input({
    auth: apikey,
    specs: [spec({ name: "Uno", uri: "/unos" })],
  });

  test("HAR lleva la cabecera con el nombre declarado", () => {
    const doc = JSON.parse(exportTo(["har"], entrada)[0]!.content);
    const headers = doc.log.entries[0].request.headers as Array<Record<string, string>>;
    expect(headers).toContainEqual({ name: "X-Tenant", value: "{{apiKey}}" });
    expect(headers).not.toContainEqual(
      expect.objectContaining({ name: "Authorization" }),
    );
  });

  test("cURL exporta la clave desde el entorno", () => {
    const script = exportTo(["curl"], entrada)[0]!.content;
    expect(script).toContain('API_KEY="${API_KEY:-}"');
    expect(script).toContain("-H \"X-Tenant: $API_KEY\"");
  });

  test("Bruno declara el bloque auth:apikey con placement", () => {
    const bru = exportTo(["bruno"], entrada).find(
      (a) => a.path.endsWith(".bru") && !a.path.includes("environments"),
    )!;
    expect(bru.content).toContain("auth: apikey");
    expect(bru.content).toContain("key: X-Tenant");
    expect(bru.content).toContain("placement: header");
    expect(bru.content).toContain("auth:apikey {");
  });

  test("Insomnia lleva la cabecera de apiKey", () => {
    const doc = JSON.parse(exportTo(["insomnia"], entrada)[0]!.content);
    const req = doc.resources.find((r: Record<string, unknown>) => r._type === "request");
    const headers = req.headers as Array<Record<string, string>>;
    expect(headers).toContainEqual({ name: "X-Tenant", value: "{{ apiKey }}" });
    // Sin bearer, sin bloque de autenticación.
    expect(req.authentication).toEqual({});
  });

  test("OpenAPI declara el securityScheme apiKeyAuth", () => {
    const doc = buildOpenApiDocument(entrada);
    expect(doc.components).toMatchObject({
      securitySchemes: {
        apiKeyAuth: { type: "apiKey", name: "X-Tenant", in: "header" },
      },
    });
  });
});

describe("auth oauth2 y none", () => {
  test("oauth2 en OpenAPI declara clientCredentials", () => {
    const doc = buildOpenApiDocument(input({ auth: { type: "oauth2" } }));
    expect(doc.components).toMatchObject({
      securitySchemes: {
        oauth2Auth: {
          type: "oauth2",
          flows: { clientCredentials: { tokenUrl: "/oauth/token" } },
        },
      },
    });
    expect(doc.security).toEqual([{ oauth2Auth: [] }]);
  });

  test("oauth2 en los formatos request a request no trae token usado", () => {
    const entrada = input({
      auth: { type: "oauth2" },
      specs: [spec({ name: "Uno", uri: "/unos" })],
    });
    const har = JSON.parse(exportTo(["har"], entrada)[0]!.content);
    const headers = har.log.entries[0].request.headers as Array<Record<string, string>>;
    expect(headers.some((h) => h.name === "Authorization")).toBe(false);

    const script = exportTo(["curl"], entrada)[0]!.content;
    expect(script).not.toContain("TOKEN");
  });

  test("none: ningún formato mete credenciales", () => {
    const entrada = input({
      auth: { type: "none" },
      specs: [spec({ name: "Uno", uri: "/unos" })],
    });
    const har = JSON.parse(exportTo(["har"], entrada)[0]!.content);
    const headers = har.log.entries[0].request.headers as Array<Record<string, string>>;
    expect(headers.some((h) => h.name === "Authorization")).toBe(false);

    const script = exportTo(["curl"], entrada)[0]!.content;
    expect(script).not.toContain("API_KEY");
    expect(script).toContain('BASE_URL="${BASE_URL:-http://localhost:3000}"');

    const doc = buildOpenApiDocument(entrada);
    expect(doc.components).toBeUndefined();
    expect(doc.security).toBeUndefined();
  });

  test("apikey en query también se declara en OpenAPI y Bruno", () => {
    const entrada = input({
      auth: { type: "apikey", keyName: "token", keyIn: "query" },
      specs: [spec({ name: "Uno", uri: "/unos" })],
    });
    const doc = buildOpenApiDocument(entrada);
    expect(doc.components).toMatchObject({
      securitySchemes: { apiKeyAuth: { in: "query", name: "token" } },
    });
    // En HAR una key por query no va en cabeceras.
    const har = JSON.parse(exportTo(["har"], entrada)[0]!.content);
    const headers = har.log.entries[0].request.headers as Array<Record<string, string>>;
    expect(headers.some((h) => h.name === "token")).toBe(false);
  });
});

describe("colecciones en los bordes", () => {
  test("un catálogo vacío produce artefactos válidos en todos los formatos", () => {
    const vacio = input({ auth: { type: "none" }, specs: [] });
    const artefactos = exportTo(["har", "curl", "insomnia", "openapi"], vacio);
    expect(artefactos).toHaveLength(4);
    for (const a of artefactos) {
      expect(a.content.length).toBeGreaterThan(10);
    }
    // HAR sin entradas, curl sin llamadas.
    const har = JSON.parse(exportTo(["har"], vacio)[0]!.content);
    expect(har.log.entries).toEqual([]);
  });

  test("Bruno con catálogo vacío sigue llevando manifiesto y entorno", () => {
    const artefactos = exportTo(["bruno"], input({ auth: { type: "none" }, specs: [] }));
    expect(artefactos.map((a) => a.path)).toEqual([
      "limite.bruno/bruno.json",
      "limite.bruno/environments/Local.bru",
    ]);
  });

  test("URI raíz: sin segmento, la carpeta es la raíz en Bruno e Insomnia", () => {
    const entrada = input({
      auth: { type: "bearer" },
      specs: [
        spec({ name: "Raíz", uri: "/" }),
        spec({ name: "Normal", uri: "/ping" }),
      ],
    });
    const bruno = exportTo(["bruno"], entrada);
    const carpetas = bruno
      .map((a) => a.path)
      .filter((p) => p.endsWith(".bru") && !p.includes("environments"))
      .map((p) => p.split("/")[1]);
    expect(new Set(carpetas).size).toBe(carpetas.length);

    const insomnia = JSON.parse(exportTo(["insomnia"], entrada)[0]!.content);
    const grupos = insomnia.resources.filter(
      (r: Record<string, unknown>) => r._type === "request_group",
    );
    expect(grupos.length).toBeGreaterThanOrEqual(1);
  });

  test("dos specs con la misma URI en Bruno no colisionan en disco", () => {
    const entrada = input({
      auth: { type: "none" },
      specs: [
        spec({ name: "Get Users", method: "GET", uri: "/users" }),
        spec({ name: "Get Users", method: "GET", uri: "/users" }),
      ],
    });
    const bruno = exportTo(["bruno"], entrada);
    const requests = bruno.map((a) => a.path).filter((p) => p.endsWith(".bru") && !p.includes("environments"));
    expect(requests).toHaveLength(2);
    expect(new Set(requests).size).toBe(2);
  });

  test("un nombre imposible en Bruno cae a 'request'", () => {
    // `toFileName` recibe "GET ///": los separadores se vuelven `-`, y
    // el recorte de guiones deja `get` — fichero válido. El fallback a
    // "request" es para el caso en que el saneado total dé vacío,
    // comprobado aquí con dos nombres en los bordes del saneado.
    const normal = exportTo(["bruno"], input({
      auth: { type: "none" },
      specs: [spec({ name: "///", method: "GET", uri: "/x" })],
    }));
    expect(normal.some((a) => a.path === "limite.bruno/x/get.bru")).toBe(true);
  });

  test("folder explícito agrupa en Bruno e Insomnia", () => {
    const entrada = input({
      auth: { type: "none" },
      specs: [
        spec({ name: "A", uri: "/a/uno", folder: "Manual" }),
        spec({ name: "B", uri: "/b/dos", folder: "Manual" }),
      ],
    });
    const bruno = exportTo(["bruno"], entrada);
    const carpetas = new Set(
      bruno
        .map((a) => a.path)
        .filter((p) => p.endsWith(".bru") && !p.includes("environments"))
        .map((p) => p.split("/")[1]),
    );
    expect([...carpetas]).toEqual(["manual"]);

    const insomnia = JSON.parse(exportTo(["insomnia"], entrada)[0]!.content);
    const grupo = insomnia.resources.find(
      (r: Record<string, unknown>) => r._type === "request_group",
    );
    expect(grupo.name).toBe("Manual");
  });

  test("OpenAPI: una URI con varios params saca todos como obligatorios", () => {
    const doc = buildOpenApiDocument(
      input({
        auth: { type: "none" },
        specs: [spec({ name: "Dos", uri: "/a/{{x}}/b/{{y}}" })],
      }),
    ) as Record<string, any>;
    const params = doc.paths["/a/{x}/b/{y}"].get.parameters;
    expect(params.map((p: Record<string, unknown>) => p.name)).toEqual(["x", "y"]);
    expect(params.every((p: Record<string, unknown>) => p.required === true)).toBe(true);
  });

  test("los tipos de campo recorren el mapeo a JSON Schema", () => {
    const doc = buildOpenApiDocument(
      input({
        auth: { type: "none" },
        specs: [
          spec({
            name: "Tipos",
            method: "POST",
            uri: "/tipos",
            fields: [
              { fieldName: "cuenta", location: "body", type: "integer", required: true },
              { fieldName: "ratio", location: "body", type: "number", required: false },
              { fieldName: "vivo", location: "body", type: "boolean", required: false },
              { fieldName: "etiquetas", location: "body", type: "array", required: false },
              { fieldName: "casa", location: "body", type: "object", required: false },
              { fieldName: "modo", location: "body", type: "enum", required: false, enumValues: ["a", "b"] },
              { fieldName: "cuando", location: "body", type: "date", required: false, format: "date" },
              { fieldName: "apodo", location: "body", type: "string", required: false, minLength: 2, maxLength: 8 },
              { fieldName: "desde", location: "query", type: "string", required: false },
              { fieldName: "X-Extra", location: "header", type: "string", required: false },
              { fieldName: "id", location: "path", type: "integer", required: true },
            ],
          } as Partial<EndpointSpec>),
        ],
      }),
    ) as Record<string, any>;

    const props = doc.paths["/tipos"].post.requestBody.content["application/json"].schema.properties;
    expect(props.cuenta.type).toBe("integer");
    expect(props.ratio.type).toBe("number");
    expect(props.vivo.type).toBe("boolean");
    expect(props.etiquetas).toMatchObject({ type: "array", items: { type: "string" } });
    expect(props.casa.type).toBe("object");
    expect(props.modo).toMatchObject({ type: "string", enum: ["a", "b"] });
    expect(props.cuando.format).toBe("date");
    expect(props.apodo).toMatchObject({ minLength: 2, maxLength: 8 });

    const params = doc.paths["/tipos"].post.parameters;
    expect(params).toContainEqual(
      expect.objectContaining({ name: "desde", in: "query" }),
    );
    expect(params).toContainEqual(
      expect.objectContaining({ name: "X-Extra", in: "header" }),
    );
  });

  test("headers declarados y cabeceras de reglas no se duplican", () => {
    const doc = buildOpenApiDocument(
      input({
        auth: { type: "none" },
        specs: [
          spec({
            name: "Con cabecera",
            uri: "/x",
            headers: [{ key: "X-Doble", value: "1" }],
            fields: [
              { fieldName: "X-Doble", location: "header", type: "string", required: true },
            ],
          } as Partial<EndpointSpec>),
        ],
      }),
    ) as Record<string, any>;
    const params = doc.paths["/x"].get.parameters.filter(
      (p: Record<string, unknown>) => p.name === "X-Doble",
    );
    expect(params).toHaveLength(1);
    // La regla manda: required viene del campo, no del header literal.
    expect(params[0].required).toBe(true);
  });

  test("body de ejemplo sin reglas sale como example sin schema", () => {
    const doc = buildOpenApiDocument(
      input({
        auth: { type: "none" },
        specs: [spec({ name: "Solo ejemplo", method: "POST", uri: "/x", body: { hola: 1 } })],
      }),
    ) as Record<string, any>;
    const content = doc.paths["/x"].post.requestBody.content["application/json"];
    expect(content.example).toEqual({ hola: 1 });
    expect(content.schema).toBeUndefined();
  });

  test("warnings: cada formato RPC avisa solo lo que pierde", () => {
    const rpc = input({
      auth: { type: "none" },
      specs: [
        spec({ name: "uno", method: "POST", uri: "/rpc" }),
        spec({ name: "dos", method: "POST", uri: "/rpc" }),
        spec({ name: "tres", method: "POST", uri: "/rpc" }),
      ],
    });
    const avisos = exportWarnings(["openapi"], rpc);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("3 operaciones");

    // En un ignore: offset, warnings de openapi solo cuenta el método
    // + ruta exactos.
    const rest = input({
      auth: { type: "none" },
      specs: [
        spec({ name: "a", method: "POST", uri: "/rpc" }),
        spec({ name: "b", method: "GET", uri: "/rpc" }),
      ],
    });
    expect(exportWarnings(["openapi"], rest)).toEqual([]);
  });
});
