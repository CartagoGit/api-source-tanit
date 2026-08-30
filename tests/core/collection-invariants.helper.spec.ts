import { describe, expect, test } from "vitest";
import { checkCollectionInvariants, collectionErrors } from "../../packages/core/helpers/collection-invariants.helper";
import { POSTMAN_SCHEMA_URL } from "../../packages/contracts/constants/core/postman.constant";
import type { PostmanCollection } from "../../packages/contracts/interfaces/core/postman.interface";
import { brokenRequest, folder, validRequest } from "../helpers/postman-builders";

const request = validRequest;

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
    const bad = brokenRequest("roto", "method");
    expect(messagesOf(collection({ item: [bad] }))).toContain("request sin method");
  });

  test("request sin url.raw", () => {
    const bad = brokenRequest("roto", "url");
    expect(messagesOf(collection({ item: [bad] }))).toContain("request sin url.raw");
  });

  test("request sin array de headers", () => {
    const bad = brokenRequest("roto", "header");
    expect(messagesOf(collection({ item: [bad] }))).toContain("request sin array de headers");
  });

  test("item que no es ni carpeta ni request", () => {
    const bad = brokenRequest("raro", "request");
    expect(messagesOf(collection({ item: [bad] }))).toContain("no es carpeta ni request");
  });

  test("item sin nombre", () => {
    const bad = request("", "GET", "{{baseUrl}}/x");
    expect(messagesOf(collection({ item: [bad] }))).toContain("item sin nombre");
  });

  test("carpeta vacía es aviso", () => {
    const vacia = folder("Users");
    const issues = checkCollectionInvariants(collection({ item: [vacia] }));
    expect(issues.some((i) => i.severity === "warning" && i.message === "carpeta vacía")).toBe(
      true,
    );
  });

  test("recorre carpetas anidadas", () => {
    const nested = folder("Users", [folder("v1", [request("", "GET", "{{baseUrl}}/x")])]);
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
      folder("A", [request("uno", "GET", "{{baseUrl}}/users")]),
      folder("B", [request("dos", "GET", "{{baseUrl}}/users")]),
    ];
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

describe("errores de .info — casos extremos", () => {
  test("info completamente ausente produce error y corta la comprobación", () => {
    const c = collection();
    Reflect.deleteProperty(c, "info");
    const issues = checkCollectionInvariants(c);
    expect(issues.some((i) => i.message === "falta .info")).toBe(true);
  });

  test("item que no es un array produce error", () => {
    const c = collection();
    Reflect.set(c, "item", "no-array");
    const issues = checkCollectionInvariants(c);
    expect(issues.some((i) => i.message === "no es un array")).toBe(true);
  });
});

describe("URL con doble barra", () => {
  test("una URL con doble barra es aviso, no error", () => {
    const c = collection({
      item: [request("Raro", "GET", "{{baseUrl}}//users")],
    });
    const issues = checkCollectionInvariants(c);
    const issue = issues.find((i) => i.message.includes("doble barra"));
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });
});

describe("duplicados con cuerpo (RPC sobre POST)", () => {
  // GraphQL usa siempre POST /graphql; el cuerpo distingue la operación.
  function rpcItem(name: string, body: string) {
    return {
      name,
      request: {
        method: "POST",
        header: [],
        url: { raw: "{{baseUrl}}/graphql", host: ["{{baseUrl}}"], path: ["graphql"] },
        body: { mode: "raw" as const, raw: body },
      },
    };
  }

  test("misma URL y método pero cuerpos distintos no es duplicado", () => {
    const items = [
      rpcItem("Query usuarios", `{"query":"{users}"}`),
      rpcItem("Query pedidos", `{"query":"{orders}"}`),
    ];
    expect(checkCollectionInvariants(collection({ item: items }))).toEqual([]);
  });

  test("misma URL, método Y cuerpo sí es duplicado", () => {
    const body = `{"query":"{users}"}`;
    const items = [rpcItem("Primera", body), rpcItem("Segunda", body)];
    expect(
      checkCollectionInvariants(collection({ item: items })).some((i) => i.message.includes("duplica")),
    ).toBe(true);
  });
});

describe("variable con nombre vacío tras trim", () => {
  test("{{   }} con solo espacios no genera aviso de variable", () => {
    const c = collection({
      item: [request("Ver", "GET", "{{baseUrl}}/x/{{   }}")],
    });
    const issues = checkCollectionInvariants(c);
    expect(issues.every((i) => !i.message.includes("{{   }}"))).toBe(true);
  });
});
