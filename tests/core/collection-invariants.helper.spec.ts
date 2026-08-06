import { describe, expect, test } from "vitest";
import {
  checkCollectionInvariants,
  collectionErrors,
} from "../../helpers/collection-invariants.helper";
import { POSTMAN_SCHEMA_URL } from "../../contracts/postman.constant";
import type { PostmanCollection, PostmanItem } from "../../contracts/postman.interface";

function request(name: string, method: string, raw: string): PostmanItem {
  return {
    name,
    request: { method, header: [], url: { raw, host: ["{{baseUrl}}"], path: [] } },
  } as unknown as PostmanItem;
}

function collection(overrides: Partial<PostmanCollection> = {}): PostmanCollection {
  return {
    info: {
      name: "API de prueba",
      description: "",
      schema: POSTMAN_SCHEMA_URL,
      _postman_id: "11111111-2222-3333-4444-555555555555",
    },
    variable: [{ key: "baseUrl", value: "http://localhost", type: "string" }],
    item: [request("Listar users", "GET", "{{baseUrl}}/users")],
    ...overrides,
  } as PostmanCollection;
}

const messagesOf = (c: PostmanCollection) =>
  checkCollectionInvariants(c).map((i) => i.message);

describe("checkCollectionInvariants — colección correcta", () => {
  test("no reporta nada sobre una colección bien formada", () => {
    expect(checkCollectionInvariants(collection())).toEqual([]);
  });
});

describe("errores de .info", () => {
  test("schema que no es v2.1.0", () => {
    const c = collection();
    c.info.schema = "https://schema.getpostman.com/json/collection/v2.0.0/collection.json";
    expect(collectionErrors(c).map((i) => i.path)).toContain("$.info.schema");
  });

  test("nombre vacío", () => {
    const c = collection();
    c.info.name = "   ";
    expect(collectionErrors(c).map((i) => i.path)).toContain("$.info.name");
  });

  // Sin `_postman_id` Postman inventa uno en cada import y el usuario
  // acaba con una colección nueva por cada regeneración.
  test("_postman_id ausente es error, no aviso", () => {
    const c = collection();
    delete (c.info as { _postman_id?: string })._postman_id;
    const issue = collectionErrors(c).find((i) => i.path === "$.info._postman_id");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("colección nueva");
  });

  test("colección sin items es aviso", () => {
    const issues = checkCollectionInvariants(collection({ item: [] }));
    expect(issues.some((i) => i.severity === "warning" && i.path === "$.item")).toBe(true);
  });
});

describe("errores de items", () => {
  test("request sin método", () => {
    const bad = { name: "roto", request: { header: [], url: { raw: "x" } } } as unknown as PostmanItem;
    expect(messagesOf(collection({ item: [bad] }))).toContain("request sin method");
  });

  test("request sin url.raw", () => {
    const bad = { name: "roto", request: { method: "GET", header: [] } } as unknown as PostmanItem;
    expect(messagesOf(collection({ item: [bad] }))).toContain("request sin url.raw");
  });

  test("request sin array de headers", () => {
    const bad = { name: "roto", request: { method: "GET", url: { raw: "x" } } } as unknown as PostmanItem;
    expect(messagesOf(collection({ item: [bad] }))).toContain("request sin array de headers");
  });

  test("item que no es ni carpeta ni request", () => {
    const bad = { name: "raro" } as unknown as PostmanItem;
    expect(messagesOf(collection({ item: [bad] }))).toContain("no es carpeta ni request");
  });

  test("item sin nombre", () => {
    const bad = request("", "GET", "{{baseUrl}}/x");
    expect(messagesOf(collection({ item: [bad] }))).toContain("item sin nombre");
  });

  test("carpeta vacía es aviso", () => {
    const folder = { name: "Users", item: [] } as unknown as PostmanItem;
    const issues = checkCollectionInvariants(collection({ item: [folder] }));
    expect(issues.some((i) => i.severity === "warning" && i.message === "carpeta vacía")).toBe(
      true,
    );
  });

  test("recorre carpetas anidadas", () => {
    const nested = {
      name: "Users",
      item: [{ name: "v1", item: [request("", "GET", "{{baseUrl}}/x")] }],
    } as unknown as PostmanItem;
    expect(messagesOf(collection({ item: [nested] }))).toContain("item sin nombre");
  });
});

describe("duplicados", () => {
  // Es el bug que tenía Symfony: el mismo endpoint declarado en YAML y
  // con #[Route] salía dos veces en la colección.
  test("detecta dos requests con el mismo método y url", () => {
    const items = [
      request("Listar users", "GET", "{{baseUrl}}/users"),
      request("Users list", "GET", "{{baseUrl}}/users"),
    ];
    const issues = checkCollectionInvariants(collection({ item: items }));
    expect(issues.some((i) => i.message.includes("duplica"))).toBe(true);
  });

  test("detecta duplicados repartidos entre carpetas distintas", () => {
    const items = [
      { name: "A", item: [request("uno", "GET", "{{baseUrl}}/users")] },
      { name: "B", item: [request("dos", "GET", "{{baseUrl}}/users")] },
    ] as unknown as PostmanItem[];
    expect(
      checkCollectionInvariants(collection({ item: items })).some((i) =>
        i.message.includes("duplica"),
      ),
    ).toBe(true);
  });

  test("mismo path con métodos distintos no es duplicado", () => {
    const items = [
      request("Listar", "GET", "{{baseUrl}}/users"),
      request("Crear", "POST", "{{baseUrl}}/users"),
    ];
    expect(checkCollectionInvariants(collection({ item: items }))).toEqual([]);
  });
});

describe("variables sin declarar", () => {
  test("avisa de una {{var}} que no está en collection.variable", () => {
    const c = collection({ item: [request("Ver", "GET", "{{baseUrl}}/users/{{id}}")] });
    const issue = checkCollectionInvariants(c).find((i) => i.message.includes("{{id}}"));
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  test("no avisa si la variable está declarada", () => {
    const c = collection({
      variable: [
        { key: "baseUrl", value: "http://localhost", type: "string" },
        { key: "id", value: "1", type: "string" },
      ],
      item: [request("Ver", "GET", "{{baseUrl}}/users/{{id}}")],
    });
    expect(checkCollectionInvariants(c)).toEqual([]);
  });

  test("no avisa de las variables dinámicas de Postman", () => {
    const c = collection({ item: [request("Ver", "GET", "{{baseUrl}}/x/{{$guid}}")] });
    expect(checkCollectionInvariants(c)).toEqual([]);
  });

  test("solo avisa una vez por variable aunque aparezca en varios sitios", () => {
    const c = collection({
      item: [
        request("Ver", "GET", "{{baseUrl}}/users/{{id}}"),
        request("Borrar", "DELETE", "{{baseUrl}}/users/{{id}}"),
      ],
    });
    expect(checkCollectionInvariants(c).filter((i) => i.message.includes("{{id}}"))).toHaveLength(
      1,
    );
  });
});

describe("collectionErrors", () => {
  test("filtra los avisos y deja solo los errores", () => {
    const c = collection({ item: [request("Ver", "GET", "{{baseUrl}}/users/{{id}}")] });
    expect(checkCollectionInvariants(c).length).toBeGreaterThan(0);
    expect(collectionErrors(c)).toEqual([]);
  });
});
