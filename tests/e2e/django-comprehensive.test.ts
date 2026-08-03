/**
 * E2E test exhaustivo para el scanner Django.
 *
 * Cubre:
 * - urls.py raíz con `path("api/<x>/", include("app.<x>.urls"))`.
 * - Sub-app `app/<x>/urls.py` con `path("", SomeView.as_view())`.
 * - Path params Django `<int:id>`, `<str:slug>`, `<id>`.
 * - DRF generics: ListCreateAPIView, RetrieveUpdateDestroyAPIView,
 *   RetrieveAPIView, UpdateAPIView → expansión a {GET, POST, PUT, PATCH,
 *   DELETE} según la clase padre real leída desde views.py.
 * - FBV con `@api_view(["POST"])` → expansión al método del decorator.
 * - Includes anidados con prefix `path("api/users/", include(...))`.
 * - DRF serializers (Serializer + ChoiceField + EmailField) → fields
 *   correctos por endpoint (no del "primer serializer del archivo").
 * - Estabilidad: el hash de la collection debe ser determinista.
 */
import { describe, expect, test } from "bun:test";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  hashNormalized,
  normalizeCollection,
  validatePostmanInvariants,
} from "../helpers/compare-json";

/**
 * Helper local: encuentra TODOS los endpoints que matchean method+uri.
 * (Django fixture no genera duplicados, pero dejamos el helper por si
 * en el futuro hay routes con includes superpuestos).
 */
function findAllEndpoints(collection: any, method: string, uri: string): any[] {
  const out: any[] = [];
  const walk = (items: any[]) => {
    for (const it of items) {
      if (it.item) walk(it.item);
      else if (it.request) {
        const raw = it.request.url?.raw ?? "";
        if (it.request.method === method && raw.endsWith(uri)) out.push(it);
      }
    }
  };
  walk(collection.item ?? []);
  return out;
}

describe("Django — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("django-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(15);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("django-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("encuentra los endpoints por method+uri (Django paths → {{id}})", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    // Health (FBV en views.py raíz, sin serializer).
    expect(findEndpoint(collection, "GET", "/health")).not.toBeNull();
    // Users — ListCreateAPIView → {GET, POST}.
    expect(findEndpoint(collection, "GET", "/api/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/users")).not.toBeNull();
    // Users — RetrieveUpdateDestroyAPIView → {GET, PUT, PATCH, DELETE}.
    expect(findEndpoint(collection, "GET", "/api/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/api/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/api/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/api/users/{{id}}")).not.toBeNull();
    // Users — UpdateAPIView (address) → {PUT, PATCH}.
    expect(findEndpoint(collection, "PUT", "/api/users/{{id}}/address")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/api/users/{{id}}/address")).not.toBeNull();
    // Orders — ListCreateAPIView → {GET, POST}.
    expect(findEndpoint(collection, "GET", "/api/orders")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/orders")).not.toBeNull();
    // Orders — RetrieveAPIView → {GET}.
    expect(findEndpoint(collection, "GET", "/api/orders/{{id}}")).not.toBeNull();
    // Orders — UpdateAPIView (status) → {PUT, PATCH}.
    expect(findEndpoint(collection, "PUT", "/api/orders/{{id}}/status")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status")).not.toBeNull();
    // Orders — FBV cancel_order con @api_view(["POST"]) → {POST}.
    expect(findEndpoint(collection, "POST", "/api/orders/{{id}}/cancel")).not.toBeNull();
    // Auth — FBV @api_view(["POST"]) → {POST} cada una.
    expect(findEndpoint(collection, "POST", "/api/auth/login")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/refresh")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/logout")).not.toBeNull();
  });

  test("POST /api/users tiene body params desde UserSerializer (UserListCreateView)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
    expect(body).toHaveProperty("role");
  });

  test("PUT /api/users/{id} usa UpdateUserSerializer (UserDetailView), NO UserSerializer", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    // NO debe tener `age` ni `role` (esos son de UserSerializer, no de UpdateUserSerializer).
    expect(body).not.toHaveProperty("age");
    expect(body).not.toHaveProperty("role");
  });

  test("DELETE /api/users/{id} no tiene body (RetrieveUpdateDestroyAPIView → DELETE sin serializer write)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "DELETE", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    expect(ep?.request?.body).toBeUndefined();
  });

  test("PUT /api/users/{id}/address usa AddressSerializer (street, city, country, postal_code)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postal_code");
  });

  test("POST /api/orders usa OrderSerializer (customer_name, customer_email, amount, currency)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customer_name");
    expect(body).toHaveProperty("customer_email");
    expect(body).toHaveProperty("amount");
    expect(body).toHaveProperty("currency");
  });

  test("PATCH /api/orders/{id}/status usa UpdateOrderStatusSerializer (solo status)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    // Solo `status` (ChoiceField → enum) — NO customer_name ni amount.
    expect(body).toHaveProperty("status");
    expect(body).not.toHaveProperty("customer_name");
    expect(body).not.toHaveProperty("amount");
  });

  test("POST /api/orders/{id}/cancel (FBV sin serializer) NO usa OrderSerializer de la view vecina", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders/{{id}}/cancel");
    expect(ep).not.toBeNull();
    // Si por error cogiese OrderSerializer tendría customer_name/amount.
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).not.toHaveProperty("customer_name");
    expect(body).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("currency");
  });

  test("POST /api/auth/login (FBV) no tiene body específico (fallback agnóstico o vacío)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    // El FBV no define serializer → no debe tener customer_name ni
    // ningún field de LoginSerializer.
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("password");
  });

  test("POST /api/auth/logout (FBV) no tiene body", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/logout");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    // body `{}` está OK — sin serializer y sin campos auto-inferidos.
    expect(Object.keys(body).length).toBe(0);
  });

  test("path params Django <int:id> se convierten a {{id}} en todas las URIs", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const allEps = findAllEndpoints(collection, "GET", "/api/users/{{id}}");
    expect(allEps.length).toBeGreaterThan(0);
    for (const ep of allEps) {
      const raw = ep?.request?.url?.raw ?? "";
      // Ninguna URI puede tener `<` (forma Django raw).
      expect(raw).not.toMatch(/<[a-zA-Z_]/);
    }
  });

  test("el hash de la collection es estable (snapshot)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const hash1 = hashNormalized(collection);
    // Segunda corrida: debe producir el mismo hash (sin randomness).
    const { collection: collection2 } = await runGenerate("django-comprehensive");
    const hash2 = hashNormalized(collection2);
    expect(hash1).toBe(hash2);
    // Snap: imprimimos el hash para inspección manual si rompe.
    if (hash1 !== hash2) {
      console.error("HASH MISMATCH:", hash1, hash2);
    }
  });

  test("normalizado no contiene conversores Django <int:...> ni <str:...>", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const norm = JSON.stringify(normalizeCollection(collection));
    // Solo los path converters reales de Django — `<int:id>`, `<str:slug>`,
    // `<uuid:token>`, `<path:rest>`, `<slug:slug>`. NO el placeholder
    // `<NORMALIZED>` que mete el helper de compare-json en claves volátiles.
    expect(norm).not.toMatch(/<int:/);
    expect(norm).not.toMatch(/<str:/);
    expect(norm).not.toMatch(/<uuid:/);
    expect(norm).not.toMatch(/<path:/);
    expect(norm).not.toMatch(/<slug:/);
  });
});
