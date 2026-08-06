import { describe, expect, test } from "vitest";
import {
  PostmanApiError,
  pushCollection,
  pushEnvironment,
  verifyApiKey,
} from "../../services/postman-api.service";
import { POSTMAN_SCHEMA_URL } from "../../contracts/postman.constant";
import type { PostmanCollection } from "../../contracts/postman.interface";

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

/** Registra las llamadas y devuelve respuestas preparadas. */
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
      text: async () => "detalle del error",
      json: async () => (key ? routes[key] : {}),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const options = (impl: typeof fetch) => ({ apiKey: "pmak-test", fetchImpl: impl });

describe("verifyApiKey", () => {
  test("devuelve el usuario asociado a la key", async () => {
    const { impl } = fakeFetch({ "/me": { user: { id: 7, username: "cartago" } } });
    expect(await verifyApiKey(options(impl))).toEqual({ id: 7, username: "cartago" });
  });

  test("manda la key en la cabecera X-Api-Key", async () => {
    const calls: string[] = [];
    const impl = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(init?.headers?.["X-Api-Key"] ?? "");
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    }) as unknown as typeof fetch;
    await verifyApiKey(options(impl));
    expect(calls[0]).toBe("pmak-test");
  });
});

describe("pushCollection", () => {
  test("crea la colección cuando no existe", async () => {
    const { impl, calls } = fakeFetch({
      "/collections": { collections: [], collection: { uid: "7-abc" } },
    });
    const result = await pushCollection(collection(), options(impl));

    expect(result.action).toBe("created");
    expect(result.uid).toBe("7-abc");
    expect(calls.some((c) => c.method === "POST")).toBe(true);
  });

  // Es lo que hace que regenerar y volver a subir no deje una copia más:
  // el `_postman_id` determinista identifica la colección existente.
  test("actualiza la que ya existe con el mismo _postman_id", async () => {
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

  test("no confunde una colección de otro proyecto", async () => {
    const { impl } = fakeFetch({
      "/collections": {
        collections: [{ uid: "7-otra", id: "otro-id-distinto", name: "Otra" }],
        collection: { uid: "7-nueva" },
      },
    });
    expect((await pushCollection(collection(), options(impl))).action).toBe("created");
  });

  test("manda la colección en el body", async () => {
    const { impl, calls } = fakeFetch({
      "/collections": { collections: [], collection: { uid: "x" } },
    });
    await pushCollection(collection(), options(impl));
    const post = calls.find((c) => c.method === "POST");
    expect((post?.body as { collection?: PostmanCollection })?.collection?.info.name).toBe(
      "Demo API",
    );
  });

  test("añade el workspace a la query cuando se indica", async () => {
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

  test("crea el environment cuando no existe", async () => {
    const { impl } = fakeFetch({
      "/environments": { environments: [], environment: { uid: "7-env" } },
    });
    expect((await pushEnvironment(environment, options(impl))).action).toBe("created");
  });

  test("actualiza el que ya existe con el mismo nombre", async () => {
    const { impl, calls } = fakeFetch({
      "/environments": { environments: [{ uid: "7-env", id: "e", name: "Local" }] },
    });
    const result = await pushEnvironment(environment, options(impl));
    expect(result.action).toBe("updated");
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });
});

describe("errores", () => {
  test.each([
    [401, /Invalid Postman API key/],
    [403, /does not have access/],
    [404, /Not found/],
    [429, /rate limit/],
  ])("el %i se traduce a un mensaje accionable", async (status, pattern) => {
    const { impl } = fakeFetch({}, status);
    await expect(verifyApiKey(options(impl))).rejects.toThrow(pattern);
  });

  test("un fallo de red no se confunde con un error de la API", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(verifyApiKey(options(impl))).rejects.toThrow(/Could not reach/);
  });

  test("el error lleva el status y el detalle de Postman", async () => {
    const { impl } = fakeFetch({}, 401);
    try {
      await verifyApiKey(options(impl));
      throw new Error("debería haber lanzado");
    } catch (err) {
      expect(err).toBeInstanceOf(PostmanApiError);
      expect((err as PostmanApiError).status).toBe(401);
      expect((err as PostmanApiError).detail).toContain("detalle");
    }
  });
});
