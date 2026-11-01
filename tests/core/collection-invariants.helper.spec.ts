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
    item: [request("List users", "GET", "{{baseUrl}}/users")],
    ...overrides,
  } as PostmanCollection;
}

const messagesOf = (c: PostmanCollection) =>
  checkCollectionInvariants(c).map((i) => i.message);

describe("checkCollectionInvariants — correct collection", () => {
  test("reports nothing on a well-formed collection", () => {
    expect(checkCollectionInvariants(collection())).toEqual([]);
  });
});

describe(".info errors", () => {
  test("schema that is not v2.1.0", () => {
    const c = collection();
    c.info.schema = "https://schema.getpostman.com/json/collection/v2.0.0/collection.json";
    expect(collectionErrors(c).map((i) => i.path)).toContain("$.info.schema");
  });

  test("empty name", () => {
    const c = collection();
    c.info.name = "   ";
    expect(collectionErrors(c).map((i) => i.path)).toContain("$.info.name");
  });

  // Without `_postman_id` Postman invents one on every import and the
  // user ends up with a new collection on every regeneration.
  test("absent _postman_id is an error, not a warning", () => {
    const c = collection();
    delete (c.info as { _postman_id?: string })._postman_id;
    const issue = collectionErrors(c).find((i) => i.path === "$.info._postman_id");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("new collection");
  });

  test("a collection without items is a warning", () => {
    const issues = checkCollectionInvariants(collection({ item: [] }));
    expect(issues.some((i) => i.severity === "warning" && i.path === "$.item")).toBe(true);
  });
});

describe("item errors", () => {
  test("request without a method", () => {
    const bad = brokenRequest("roto", "method");
    expect(messagesOf(collection({ item: [bad] }))).toContain("request without method");
  });

  test("request without url.raw", () => {
    const bad = brokenRequest("roto", "url");
    expect(messagesOf(collection({ item: [bad] }))).toContain("request without url.raw");
  });

  test("request without a headers array", () => {
    const bad = brokenRequest("roto", "header");
    expect(messagesOf(collection({ item: [bad] }))).toContain("request without headers array");
  });

  test("item that is neither folder nor request", () => {
    const bad = brokenRequest("raro", "request");
    expect(messagesOf(collection({ item: [bad] }))).toContain("neither folder nor request");
  });

  test("item without a name", () => {
    const bad = request("", "GET", "{{baseUrl}}/x");
    expect(messagesOf(collection({ item: [bad] }))).toContain("item without name");
  });

  test("empty folder is a warning", () => {
    const vacia = folder("Users");
    const issues = checkCollectionInvariants(collection({ item: [vacia] }));
    expect(issues.some((i) => i.severity === "warning" && i.message === "empty folder")).toBe(
      true,
    );
  });

  test("walks nested folders", () => {
    const nested = folder("Users", [folder("v1", [request("", "GET", "{{baseUrl}}/x")])]);
    expect(messagesOf(collection({ item: [nested] }))).toContain("item without name");
  });
});

describe("duplicates", () => {
  // This is the bug Symfony had: the same endpoint declared in YAML
  // and with #[Route] appeared twice in the collection.
  test("detects two requests with the same method and url", () => {
    const items = [
      request("List users", "GET", "{{baseUrl}}/users"),
      request("Users list", "GET", "{{baseUrl}}/users"),
    ];
    const issues = checkCollectionInvariants(collection({ item: items }));
    expect(issues.some((i) => i.message.includes("duplica"))).toBe(true);
  });

  test("detects duplicates spread across different folders", () => {
    const items = [
      folder("A", [request("one", "GET", "{{baseUrl}}/users")]),
      folder("B", [request("two", "GET", "{{baseUrl}}/users")]),
    ];
    expect(
      checkCollectionInvariants(collection({ item: items })).some((i) =>
        i.message.includes("duplica"),
      ),
    ).toBe(true);
  });

  test("same path with different methods is not a duplicate", () => {
    const items = [
      request("List", "GET", "{{baseUrl}}/users"),
      request("Create", "POST", "{{baseUrl}}/users"),
    ];
    expect(checkCollectionInvariants(collection({ item: items }))).toEqual([]);
  });
});

describe("undeclared variables", () => {
  test("warns about a {{var}} that is not in collection.variable", () => {
    const c = collection({ item: [request("View", "GET", "{{baseUrl}}/users/{{id}}")] });
    const issue = checkCollectionInvariants(c).find((i) => i.message.includes("{{id}}"));
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  test("does not warn if the variable is declared", () => {
    const c = collection({
      variable: [
        { key: "baseUrl", value: "http://localhost", type: "string" },
        { key: "id", value: "1", type: "string" },
      ],
      item: [request("View", "GET", "{{baseUrl}}/users/{{id}}")],
    });
    expect(checkCollectionInvariants(c)).toEqual([]);
  });

  test("does not warn about Postman's dynamic variables", () => {
    const c = collection({ item: [request("View", "GET", "{{baseUrl}}/x/{{$guid}}")] });
    expect(checkCollectionInvariants(c)).toEqual([]);
  });

  test("warns only once per variable even if it appears in several places", () => {
    const c = collection({
      item: [
        request("View", "GET", "{{baseUrl}}/users/{{id}}"),
        request("Delete", "DELETE", "{{baseUrl}}/users/{{id}}"),
      ],
    });
    expect(checkCollectionInvariants(c).filter((i) => i.message.includes("{{id}}"))).toHaveLength(
      1,
    );
  });
});

describe("collectionErrors", () => {
  test("filters the warnings and leaves only the errors", () => {
    const c = collection({ item: [request("View", "GET", "{{baseUrl}}/users/{{id}}")] });
    expect(checkCollectionInvariants(c).length).toBeGreaterThan(0);
    expect(collectionErrors(c)).toEqual([]);
  });
});

describe(".info errors — edge cases", () => {
  test("completely absent info produces an error and short-circuits the check", () => {
    const c = collection();
    Reflect.deleteProperty(c, "info");
    const issues = checkCollectionInvariants(c);
    expect(issues.some((i) => i.message === "missing .info")).toBe(true);
  });

  test("item that is not an array produces an error", () => {
    const c = collection();
    Reflect.set(c, "item", "no-array");
    const issues = checkCollectionInvariants(c);
    expect(issues.some((i) => i.message === "not an array")).toBe(true);
  });
});

describe("URL with a double slash", () => {
  test("a URL with a double slash is a warning, not an error", () => {
    const c = collection({
      item: [request("Weird", "GET", "{{baseUrl}}//users")],
    });
    const issues = checkCollectionInvariants(c);
    const issue = issues.find((i) => i.message.includes("double slash"));
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });
});

describe("duplicates with body (RPC over POST)", () => {
  // GraphQL always uses POST /graphql; the body distinguishes the
  // operation.
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

  test("same URL and method but different bodies is not a duplicate", () => {
    const items = [
      rpcItem("Query users", `{"query":"{users}"}`),
      rpcItem("Query orders", `{"query":"{orders}"}`),
    ];
    expect(checkCollectionInvariants(collection({ item: items }))).toEqual([]);
  });

  test("same URL, method AND body IS a duplicate", () => {
    const body = `{"query":"{users}"}`;
    const items = [rpcItem("First", body), rpcItem("Second", body)];
    expect(
      checkCollectionInvariants(collection({ item: items })).some((i) => i.message.includes("duplica")),
    ).toBe(true);
  });
});

describe("variable with an empty name after trim", () => {
  test("{{   }} with only spaces does not generate a variable warning", () => {
    const c = collection({
      item: [request("View", "GET", "{{baseUrl}}/x/{{   }}")],
    });
    const issues = checkCollectionInvariants(c);
    expect(issues.every((i) => !i.message.includes("{{   }}"))).toBe(true);
  });
});
