import { describe, expect, test } from "vitest";
import { runGenerate } from "../helpers/run-scanner";
import { findEndpoint, validatePostmanInvariants } from "../helpers/compare-json";

describe("x00055 S3 — express multi-router E2E", () => {
  test("genera rutas con el prefijo correcto y sin cruce entre routers", async () => {
    const { collection, metrics } = await runGenerate("express-multi-router");

    expect(validatePostmanInvariants(collection)).toEqual([]);
    expect(metrics.routes).toBe(5);

    expect(findEndpoint(collection, "GET", "/health")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/api/users/profile")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/users/invite")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/api/orders/history")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/orders/checkout")).not.toBeNull();

    expect(findEndpoint(collection, "GET", "/api/orders/profile")).toBeNull();
    expect(findEndpoint(collection, "POST", "/api/orders/invite")).toBeNull();
    expect(findEndpoint(collection, "GET", "/api/users/history")).toBeNull();
    expect(findEndpoint(collection, "POST", "/api/users/checkout")).toBeNull();
  });
});
