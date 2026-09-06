import { describe, expect, test } from "vitest";
import { PostmanApiError, pushCollection, pushEnvironment, verifyApiKey } from "../../packages/core/domain/postman-api.service";
import { POSTMAN_SCHEMA_URL } from "../../packages/contracts/constants/core/postman.constant";
import type { PostmanCollection } from "../../packages/contracts/interfaces/core/postman.interface";

const COLLECTION_ID = "11111111-2222-3333-4444-555555555555";

const collection = (): PostmanCollection =>
  ({
    info: {
      name: "Demo API",
      description: "",
      schema: POSTMAN_SCHEMA_URL,
      _postman_id: COLLECTION_ID,
    },
    variable: [],
    item: [],
  }) as PostmanCollection;

/** Records the calls and returns prepared responses. */
function fakeFetch(routes: Record<string, unknown>, status = 200) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const impl = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const key = Object.keys(routes).find((k) => url.includes(k));
    return {
      ok: status >= 200 && status < 300,
      status,
      // x00051 S1: `IFetchResponse` exige `headers` desde que la
      // ambient cubre el caso real (`ui-server.test` lee
      // `content-security-policy` y eso motivó la declaración). El
      // stub devuelve un `Headers`-shape mínimo.
      headers: { get: () => null },
      text: async () => "detalle del error",
      json: async () => (key ? routes[key] : {}),
    };
  });
  return { impl, calls };
}

const options = (impl: typeof fetch) => ({ apiKey: "pmak-test", fetchImpl: impl });

describe("verifyApiKey", () => {
  test("returns the user associated with the key", async () => {
    const { impl } = fakeFetch({ "/me": { user: { id: 7, username: "cartago" } } });
    expect(await verifyApiKey(options(impl))).toEqual({ id: 7, username: "cartago" });
  });

  test("sends the key in the X-Api-Key header", async () => {
    const calls: string[] = [];
    const impl = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(init?.headers?.["X-Api-Key"] ?? "");
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => "",
        json: async () => ({}),
      };
    });
    await verifyApiKey(options(impl));
    expect(calls[0]).toBe("pmak-test");
  });
});

describe("pushCollection", () => {
  test("creates the collection when it does not exist", async () => {
    const { impl, calls } = fakeFetch({
      "/collections": { collections: [], collection: { uid: "7-abc" } },
    });
    const result = await pushCollection(collection(), options(impl));

    expect(result.action).toBe("created");
    expect(result.uid).toBe("7-abc");
    expect(calls.some((c) => c.method === "POST")).toBe(true);
  });

  // This is what makes regenerating and re-uploading not leave an
  // extra copy: the deterministic `_postman_id` identifies the
  // existing collection.
  test("updates the existing one with the same _postman_id", async () => {
    const { impl, calls } = fakeFetch({
      "/collections": {
        collections: [{ uid: "7-abc", id: COLLECTION_ID, name: "Demo API" }],
      },
    });
    const result = await pushCollection(collection(), options(impl));

    expect(result.action).toBe("updated");
    expect(calls.some((c) => c.method === "PUT" && c.url.includes("7-abc"))).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  test("does not confuse a collection from another project", async () => {
    const { impl } = fakeFetch({
      "/collections": {
        collections: [{ uid: "7-otra", id: "otro-id-distinto", name: "Otra" }],
        collection: { uid: "7-nueva" },
      },
    });
    expect((await pushCollection(collection(), options(impl))).action).toBe("created");
  });

  test("sends the collection in the body", async () => {
    const { impl, calls } = fakeFetch({
      "/collections": { collections: [], collection: { uid: "x" } },
    });
    await pushCollection(collection(), options(impl));
    const post = calls.find((c) => c.method === "POST");
    expect((post?.body as { collection?: PostmanCollection })?.collection?.info.name).toBe(
      "Demo API",
    );
  });

  test("appends the workspace to the query when given", async () => {
    const { impl, calls } = fakeFetch({
      "/collections": { collections: [], collection: { uid: "x" } },
    });
    await pushCollection(collection(), {
      apiKey: "k",
      workspaceId: "ws-1",
      fetchImpl: impl,
    });
    expect(calls.find((c) => c.method === "POST")?.url).toContain("workspace=ws-1");
  });
});

describe("pushEnvironment", () => {
  const environment = { name: "Local", values: [] };

  test("creates the environment when it does not exist", async () => {
    const { impl } = fakeFetch({
      "/environments": { environments: [], environment: { uid: "7-env" } },
    });
    expect((await pushEnvironment(environment, options(impl))).action).toBe("created");
  });

  test("updates the existing one with the same name", async () => {
    const { impl, calls } = fakeFetch({
      "/environments": { environments: [{ uid: "7-env", id: "e", name: "Local" }] },
    });
    const result = await pushEnvironment(environment, options(impl));
    expect(result.action).toBe("updated");
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });
});

describe("errors", () => {
  test.each([
    [401, /Invalid Postman API key/],
    [403, /does not have access/],
    [404, /Not found/],
    [429, /rate limit/],
  ])("status %i is translated to an actionable message", async (status, pattern) => {
    const { impl } = fakeFetch({}, status);
    await expect(verifyApiKey(options(impl))).rejects.toThrow(pattern);
  });

  test("a network failure is not confused with an API error", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(verifyApiKey(options(impl))).rejects.toThrow(/Could not reach/);
  });

  test("the error carries the status and the Postman detail", async () => {
    const { impl } = fakeFetch({}, 401);
    try {
      await verifyApiKey(options(impl));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PostmanApiError);
      expect((err as PostmanApiError).status).toBe(401);
      expect((err as PostmanApiError).detail).toContain("detalle");
    }
  });
});
