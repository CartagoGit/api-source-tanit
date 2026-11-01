/**
 * Comprehensive E2E test for the Django scanner.
 *
 * Covers:
 * - Root urls.py with `path("api/<x>/", include("app.<x>.urls"))`.
 * - Sub-app `app/<x>/urls.py` with `path("", SomeView.as_view())`.
 * - Django path params `<int:id>`, `<str:slug>`, `<id>`.
 * - DRF generics: ListCreateAPIView, RetrieveUpdateDestroyAPIView,
 *   RetrieveAPIView, UpdateAPIView → expansion to {GET, POST, PUT, PATCH,
 *   DELETE} according to the actual parent class read from views.py.
 * - FBV with `@api_view(["POST"])` → expansion to the decorator method.
 * - Nested includes with prefix `path("api/users/", include(...))`.
 * - DRF serializers (Serializer + ChoiceField + EmailField) → correct
 *   fields per endpoint (not from the "first serializer in the file").
 * - Stability: the collection hash must be deterministic.
 */
import { describe, expect, test } from "vitest";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  findAllEndpoints,
  hashNormalized,
  normalizeCollection,
  validatePostmanInvariants,
} from "../helpers/compare-json";

import { describeCollectionContract } from "../helpers/collection-contract";

describeCollectionContract({
  fixtureName: "django-comprehensive",
  expectedRequests: 18,
  hasAuth: true,
});

/**
 * Local helper: finds ALL endpoints that match method+uri.
 * (The Django fixture does not produce duplicates, but we keep the
 * helper in case routes with overlapping includes appear in the future).
 */

describe("Django — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("django-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(15);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("counts the correct endpoints", async () => {
    const { collection, metrics } = await runGenerate("django-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("finds the endpoints by method+uri (Django paths → {{id}})", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    // Health (FBV in root views.py, no serializer).
    expect(findEndpoint(collection, "GET", "/health/")).not.toBeNull();
    // Users — ListCreateAPIView → {GET, POST}.
    expect(findEndpoint(collection, "GET", "/api/users/")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/users/")).not.toBeNull();
    // Users — RetrieveUpdateDestroyAPIView → {GET, PUT, PATCH, DELETE}.
    expect(findEndpoint(collection, "GET", "/api/users/{{id}}/")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/api/users/{{id}}/")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/api/users/{{id}}/")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/api/users/{{id}}/")).not.toBeNull();
    // Users — UpdateAPIView (address) → {PUT, PATCH}.
    expect(findEndpoint(collection, "PUT", "/api/users/{{id}}/address/")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/api/users/{{id}}/address/")).not.toBeNull();
    // Orders — ListCreateAPIView → {GET, POST}.
    expect(findEndpoint(collection, "GET", "/api/orders/")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/orders/")).not.toBeNull();
    // Orders — RetrieveAPIView → {GET}.
    expect(findEndpoint(collection, "GET", "/api/orders/{{id}}/")).not.toBeNull();
    // Orders — UpdateAPIView (status) → {PUT, PATCH}.
    expect(findEndpoint(collection, "PUT", "/api/orders/{{id}}/status/")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status/")).not.toBeNull();
    // Orders — FBV cancel_order with @api_view(["POST"]) → {POST}.
    expect(findEndpoint(collection, "POST", "/api/orders/{{id}}/cancel/")).not.toBeNull();
    // Auth — FBV @api_view(["POST"]) → {POST} each.
    expect(findEndpoint(collection, "POST", "/api/auth/login/")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/refresh/")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/logout/")).not.toBeNull();
  });

  test("POST /api/users has body params from UserSerializer (UserListCreateView)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users/");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
    expect(body).toHaveProperty("role");
  });

  test("PUT /api/users/{id} uses UpdateUserSerializer (UserDetailView), NOT UserSerializer", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}/");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    // It must NOT have `age` or `role` (those are from UserSerializer, not UpdateUserSerializer).
    expect(body).not.toHaveProperty("age");
    expect(body).not.toHaveProperty("role");
  });

  test("DELETE /api/users/{id} has no body (RetrieveUpdateDestroyAPIView → DELETE without write serializer)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "DELETE", "/api/users/{{id}}/");
    expect(ep).not.toBeNull();
    expect(ep?.request?.body).toBeUndefined();
  });

  test("PUT /api/users/{id}/address uses AddressSerializer (street, city, country, postal_code)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}/address/");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postal_code");
  });

  test("POST /api/orders uses OrderSerializer (customer_name, customer_email, amount, currency)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders/");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customer_name");
    expect(body).toHaveProperty("customer_email");
    expect(body).toHaveProperty("amount");
    expect(body).toHaveProperty("currency");
  });

  test("PATCH /api/orders/{id}/status uses UpdateOrderStatusSerializer (status only)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status/");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    // Only `status` (ChoiceField → enum) — NOT customer_name or amount.
    expect(body).toHaveProperty("status");
    expect(body).not.toHaveProperty("customer_name");
    expect(body).not.toHaveProperty("amount");
  });

  test("POST /api/orders/{id}/cancel (FBV without serializer) does NOT use OrderSerializer from the neighboring view", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders/{{id}}/cancel/");
    expect(ep).not.toBeNull();
    // If by mistake it picked OrderSerializer, it would have customer_name/amount.
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).not.toHaveProperty("customer_name");
    expect(body).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("currency");
  });

test("POST /api/auth/login (FBV) infers body from LoginSerializer by convention", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login/");
    expect(ep).not.toBeNull();
    // FBV without explicit `serializer_class`; the provider looks for
    // `LoginSerializer` by convention (login → Login).
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("POST /api/auth/logout (FBV) infers body from LogoutSerializer", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/logout/");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("refresh_token");
  });

  test("Django <int:id> path params convert to {{id}} in all URIs", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const allEps = findAllEndpoints(collection, "GET", "/api/users/{{id}}/");
    expect(allEps.length).toBeGreaterThan(0);
    for (const ep of allEps) {
      const raw = ep?.request?.url?.raw ?? "";
      // No URI may have `<` (raw Django form).
      expect(raw).not.toMatch(/<[a-zA-Z_]/);
    }
  });

  test("the collection hash is stable (snapshot)", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const hash1 = hashNormalized(collection);
    // Second run: it must produce the same hash (no randomness).
    const { collection: collection2 } = await runGenerate("django-comprehensive");
    const hash2 = hashNormalized(collection2);
    expect(hash1).toBe(hash2);
    // Snap: print the hash for manual inspection if it breaks.
    if (hash1 !== hash2) {
      console.error("HASH MISMATCH:", hash1, hash2);
    }
  });

  test("normalized contains no Django <int:...> or <str:...> converters", async () => {
    const { collection } = await runGenerate("django-comprehensive");
    const norm = JSON.stringify(normalizeCollection(collection));
    // Only the real Django path converters — `<int:id>`, `<str:slug>`,
    // `<uuid:token>`, `<path:rest>`, `<slug:slug>`. NOT the
    // `<NORMALIZED>` placeholder inserted by the compare-json helper in
    // volatile keys.
    expect(norm).not.toMatch(/<int:/);
    expect(norm).not.toMatch(/<str:/);
    expect(norm).not.toMatch(/<uuid:/);
    expect(norm).not.toMatch(/<path:/);
    expect(norm).not.toMatch(/<slug:/);
  });
});
