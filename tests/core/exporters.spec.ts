/**
 * Los exportadores a otros formatos.
 *
 * Todos parten del **mismo** catálogo de endpoints que la colección de
 * Postman, así que lo que se comprueba aquí no es el escaneo: es que
 * cada formato dice lo mismo en su propio idioma, y que lo dice de forma
 * que su herramienta lo acepte.
 */
import { describe, expect, test } from "vitest";

import {
  DEFAULT_FORMAT,
  describeFormats,
  exportTo,
  exportWarnings,
  exporterFor,
  parseFormats,
  supportedFormats,
} from "../../projects/core/exporters/export-registry.service";
import { buildOpenApiDocument } from "../../projects/core/exporters/openapi.exporter";
import type {
  IExportInput,
} from "../../projects/contracts/interfaces/core/export-target.interface";
import type { EndpointSpec } from "../../projects/contracts/interfaces/core/postman.interface";

const specs: EndpointSpec[] = [
  {
    name: "List Users",
    method: "GET",
    uri: "/api/users",
    description: "listUsers",
    query: [{ key: "page", value: "1" }],
  },
  {
    name: "Create User",
    method: "POST",
    uri: "/api/users",
    body: { name: "Ada", age: 36 },
    fields: [
      { fieldName: "name", location: "body", type: "string", required: true, minLength: 1 },
      { fieldName: "age", location: "body", type: "number", required: false, minimum: 0, maximum: 120 },
    ],
  },
  { name: "Get User", method: "GET", uri: "/api/users/{{id}}" },
] as EndpointSpec[];

const input: IExportInput = {
  specs,
  config: {
    name: "mi-api",
    collectionName: "Mi API",
    collectionDescription: "Una API",
    baseUrl: "http://localhost:3000",
    variables: [{ key: "id", value: "1" }],
  } as IExportInput["config"],
  auth: { type: "bearer" },
};

describe("el registro", () => {
  test("`postman` es un formato válido aunque no tenga exportador", () => {
    // Lo produce el pipeline, que hace bastante más que serializar.
    expect(supportedFormats()).toContain(DEFAULT_FORMAT);
    expect(exporterFor(DEFAULT_FORMAT)).toBeNull();
  });

  test("los cinco formatos extra están registrados", () => {
    for (const f of ["openapi", "insomnia", "bruno", "har", "curl"]) {
      expect(exporterFor(f), f).not.toBeNull();
    }
  });

  test("cada formato se describe para la ayuda", () => {
    for (const { format, summary } of describeFormats()) {
      expect(summary.length, format).toBeGreaterThan(5);
    }
  });

  // Una lista de formatos escrita a mano se quedaría vieja el día que se
  // añada el sexto, y rechazaría como inválido algo que sí existe.
  test("la lista de válidos sale del registro", () => {
    expect(supportedFormats()).toEqual(
      describeFormats().map((d) => d.format),
    );
  });
});

describe("parseFormats", () => {
  test("sin flag, solo postman", () => {
    expect(parseFormats(null)).toEqual({ ok: true, formats: ["postman"] });
    expect(parseFormats("")).toEqual({ ok: true, formats: ["postman"] });
  });

  test("acepta varios y conserva el orden pedido", () => {
    const r = parseFormats("openapi,postman");
    expect(r.ok && r.formats).toEqual(["openapi", "postman"]);
  });

  test("quita repetidos", () => {
    const r = parseFormats("har,har,curl");
    expect(r.ok && r.formats).toEqual(["har", "curl"]);
  });

  test("tolera espacios y mayúsculas", () => {
    const r = parseFormats(" OpenAPI , Bruno ");
    expect(r.ok && r.formats).toEqual(["openapi", "bruno"]);
  });

  // Descubrir un nombre mal escrito al final —tras recorrer el proyecto
  // y sin haber escrito el fichero que se pedía— no dice nada.
  test("un formato inventado falla y lista los válidos", () => {
    const r = parseFormats("postman,inventado");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.invalid).toEqual(["inventado"]);
      expect(r.valid).toContain("openapi");
    }
  });
});

describe("OpenAPI", () => {
  // La estructura se comprueba sobre el objeto; que el YAML salga bien es
  // otro problema, y lo cubre `yaml.helper.spec.ts`.
  const doc = buildOpenApiDocument(input) as Record<string, any>;

  test("es 3.1.0 con servidor y título", () => {
    expect(doc["openapi"]).toBe("3.1.0");
    expect(doc["servers"][0].url).toBe("http://localhost:3000");
    expect(doc["info"].title).toBe("Mi API");
  });

  // `/users` con GET y POST es UNA entrada con dos operaciones, no dos.
  test("agrupa los métodos bajo el mismo path", () => {
    expect(Object.keys(doc["paths"]["/api/users"]).sort()).toEqual(["get", "post"]);
  });

  test("traduce `{{id}}` al `{id}` de OpenAPI", () => {
    expect(doc["paths"]["/api/users/{id}"]).toBeDefined();
  });

  test("los parámetros de ruta son obligatorios, lo dice la especificación", () => {
    const params = doc["paths"]["/api/users/{id}"].get.parameters;
    expect(params[0]).toMatchObject({ name: "id", in: "path", required: true });
  });

  test("el body lleva sus tipos y su lista de obligatorios", () => {
    const schema =
      doc["paths"]["/api/users"].post.requestBody.content["application/json"].schema;
    expect(schema.required).toEqual(["name"]);
    expect(schema.properties.name).toMatchObject({ type: "string", minLength: 1 });
    // Sobre un número la cota es de valor, no de longitud.
    expect(schema.properties.age).toMatchObject({ type: "number", minimum: 0, maximum: 120 });
  });

  test("el esquema de seguridad sale del auth detectado", () => {
    expect(doc["components"].securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  /**
   * Este proyecto escanea lo que la API **recibe**. Lo que devuelve no
   * está en ninguna señal que se lea, así que se emite el 200 mínimo que
   * OpenAPI exige, sin esquema.
   */
  test("no se inventa la forma de la respuesta", () => {
    const responses = doc["paths"]["/api/users"].get.responses;
    expect(responses["200"]).toEqual({ description: "OK" });
  });

  test("se emite como YAML, que es como se publica un OpenAPI", () => {
    const artifact = exportTo(["openapi"], input)[0]!;
    expect(artifact.path.endsWith(".openapi.yaml")).toBe(true);
    expect(artifact.content.startsWith('openapi: "3.1.0"')).toBe(true);
  });

  // Las claves de OpenAPI son rutas, códigos de estado y mime types: las
  // tres necesitan comillas o YAML las lee como otra cosa.
  test("las claves problemáticas salen citadas en el YAML", () => {
    const yaml = exportTo(["openapi"], input)[0]!.content;
    expect(yaml).toContain('"/api/users":');
    expect(yaml).toContain('"200":');
    expect(yaml).toContain('"application/json":');
  });
});

describe("Insomnia", () => {
  const doc = JSON.parse(exportTo(["insomnia"], input)[0]!.content) as Record<string, any>;
  const resources = doc["resources"] as Array<Record<string, any>>;

  test("declara el formato de exportación que Insomnia espera", () => {
    expect(doc["__export_format"]).toBe(4);
  });

  test("la jerarquía va por parentId, no por anidamiento", () => {
    const workspace = resources.find((r) => r["_type"] === "workspace");
    const group = resources.find((r) => r["_type"] === "request_group");
    expect(workspace!["parentId"]).toBeNull();
    expect(group!["parentId"]).toBe(workspace!["_id"]);
  });

  /**
   * Insomnia usa el `_id` para decidir si una importación actualiza o
   * crea. Con ids aleatorios, reimportar duplicaría la colección entera
   * cada vez — el mismo problema que el `_postman_id`.
   */
  test("los ids son estables entre generaciones", () => {
    const otra = JSON.parse(exportTo(["insomnia"], input)[0]!.content) as Record<string, any>;
    expect(
      (otra["resources"] as ReadonlyArray<Record<string, unknown>>).map((r) => r["_id"]),
    ).toEqual(resources.map((r) => r["_id"]));
  });

  test("los ids son distintos entre recursos distintos", () => {
    const ids = resources.map((r) => r["_id"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("el body viaja como texto JSON", () => {
    const post = resources.find((r) => r["method"] === "POST");
    expect(JSON.parse(post!["body"].text)).toEqual({ name: "Ada", age: 36 });
  });
});

describe("Bruno", () => {
  const artifacts = exportTo(["bruno"], input);
  const byPath = new Map(artifacts.map((a) => [a.path, a.content]));

  test("es un árbol de ficheros, no un fichero", () => {
    expect(artifacts.length).toBeGreaterThan(3);
  });

  // Sin `bruno.json` la carpeta no se abre como colección.
  test("lleva su bruno.json", () => {
    const manifest = [...byPath.keys()].find((p) => p.endsWith("bruno.json"));
    expect(manifest).toBeDefined();
    expect(JSON.parse(byPath.get(manifest!)!)).toMatchObject({ type: "collection" });
  });

  test("un .bru por request, con sus bloques", () => {
    const bru = [...byPath.entries()].find(([p]) => p.includes("post-create-user"));
    expect(bru).toBeDefined();
    const content = bru![1];
    expect(content).toContain("meta {");
    expect(content).toContain("post {");
    expect(content).toContain("url: {{baseUrl}}/api/users");
    expect(content).toContain("body:json {");
  });

  // `Get User` y `List Users` podrían colisionar; el segundo pisaría al
  // primero sin decir nada.
  test("no hay dos artefactos con la misma ruta", () => {
    const paths = artifacts.map((a) => a.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("las variables van a un entorno", () => {
    const env = [...byPath.keys()].find((p) => p.includes("environments/"));
    expect(byPath.get(env!)).toContain("baseUrl: http://localhost:3000");
  });
});

describe("HAR", () => {
  const doc = JSON.parse(exportTo(["har"], input)[0]!.content) as Record<string, any>;

  test("es HAR 1.2 con una entrada por endpoint", () => {
    expect(doc["log"].version).toBe("1.2");
    expect(doc["log"].entries).toHaveLength(3);
  });

  /**
   * HAR es un formato de REGISTRO: sus entradas exigen un objeto
   * `response`. Aquí no hay respuestas porque nunca se ha ejecutado
   * nada, así que se emite el que el formato define para "no capturada"
   * en vez de inventarse un 200.
   */
  test("la respuesta va marcada como no capturada, no como un 200", () => {
    expect(doc["log"].entries[0].response.status).toBe(0);
    expect(doc["log"].entries[0].time).toBe(-1);
  });

  test("las variables se dejan sin resolver", () => {
    expect(doc["log"].entries[0].request.url).toContain("{{baseUrl}}");
  });
});

describe("cURL", () => {
  const script = exportTo(["curl"], input)[0]!.content;

  test("es un script de shell con `set -eu`", () => {
    expect(script.startsWith("#!/usr/bin/env sh")).toBe(true);
    expect(script).toContain("set -eu");
  });

  test("las variables de Postman pasan a variables de shell", () => {
    // `{{id}}` no lo entiende curl.
    expect(script).toContain("${id}");
    expect(script).not.toContain("{{id}}");
  });

  test("el token del bearer sale del entorno", () => {
    expect(script).toContain('TOKEN="${TOKEN:-}"');
    expect(script).toContain("Authorization: Bearer $TOKEN");
  });

  test("un body con comillas no rompe el escapado", () => {
    const conComillas = exportTo(["curl"], {
      ...input,
      specs: [{ name: "x", method: "POST", uri: "/x", body: { q: "d'ohn" } } as EndpointSpec],
    })[0]!.content;
    expect(conComillas).toContain(`'\\''`);
  });
});

describe("todos los formatos a la vez", () => {
  test("cada uno produce sus ficheros, sin pisarse", () => {
    const artifacts = exportTo(["openapi", "insomnia", "bruno", "har", "curl"], input);
    const paths = artifacts.map((a) => a.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.some((p) => p.endsWith(".openapi.yaml"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".insomnia.json"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".har"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".curl.sh"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".bru"))).toBe(true);
  });

  test("`postman` se salta: lo escribe el pipeline", () => {
    expect(exportTo(["postman"], input)).toEqual([]);
  });
});

/**
 * Lo que un formato no puede representar.
 *
 * OpenAPI identifica una operación por **ruta + método**, así que un
 * proyecto GraphQL —cinco `POST /graphql` distintos— se queda en uno.
 * Eso no es un fallo del exportador, es la forma del formato; el fallo
 * sería **callarlo**: el fichero sale con una operación de cinco y
 * parece correcto.
 */
describe("avisos de lo que se pierde", () => {
  const rpcInput: IExportInput = {
    ...input,
    specs: [
      { name: "query users", method: "POST", uri: "/graphql", body: { query: "a" } },
      { name: "query user", method: "POST", uri: "/graphql", body: { query: "b" } },
      { name: "mutation createUser", method: "POST", uri: "/graphql", body: { query: "c" } },
    ] as EndpointSpec[],
  };

  test("OpenAPI avisa de las operaciones que agrupa", () => {
    const warnings = exportWarnings(["openapi"], rpcInput);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("POST /graphql");
    expect(warnings[0]).toContain("3 operaciones");
  });

  // Sin decir cuál se conserva, el aviso no deja saber qué revisar.
  test("dice cuál se conserva y cuáles se pierden", () => {
    const warning = exportWarnings(["openapi"], rpcInput)[0] ?? "";
    expect(warning).toContain("query users");
    expect(warning).toContain("query user, mutation createUser");
  });

  // El aviso dice que se conserva la primera: el documento tiene que
  // coincidir, o el aviso miente.
  test("el documento conserva justo la que dice el aviso", () => {
    const doc = buildOpenApiDocument(rpcInput) as Record<string, any>;
    expect(doc["paths"]["/graphql"].post.summary).toBe("query users");
  });

  test("una API REST normal no genera ningún aviso", () => {
    expect(exportWarnings(["openapi"], input)).toEqual([]);
  });

  test("los formatos que lo representan todo no avisan", () => {
    // Postman, Insomnia, Bruno, HAR y cURL guardan una entrada por
    // request, así que ninguno pierde nada.
    expect(exportWarnings(["insomnia", "bruno", "har", "curl"], rpcInput)).toEqual([]);
  });
});
