/**
 * FastAPI response inferrer tests (f00012 S3).
 *
 * Pins the three signals the proposal lists for S3:
 *
 *   (a) `@app.get("/x", response_model=UserResponse, status_code=201)`
 *       → 201 high.
 *   (b) `@app.get("/x", response_model=UserResponse)` → 200 high.
 *   (c) `def handler() -> UserResponse:` → 200 medium.
 *   (d) Source from a non-fastapi framework → [].
 */
import { describe, expect, test, beforeEach } from "vitest";

import {
  inferResponses,
  __setInferrersForTest,
} from "../../packages/core/responses/infer-responses";
import {
  FastApiResponseInferrer,
} from "../../packages/frameworks/scanners/fastapi.response-inferrer";
import type {
  EndpointSpecLike,
  IFrameworkSourceFileLike,
} from "../../packages/contracts/interfaces/core/responses.interface";

const SPEC: EndpointSpecLike = { method: "GET", uri: "/x" };
function source(content: string, framework = "fastapi"): IFrameworkSourceFileLike {
  return {
    path: "/app/routes/users.py",
    content,
    framework,
  };
}

describe("FastAPI response inferrer (f00012 S3)", () => {
  beforeEach(() => __setInferrersForTest([]));

  test("(a) response_model + status_code=201 → 201 high", () => {
    __setInferrersForTest([new FastApiResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @app.post("/users", response_model=UserResponse, status_code=201)
        async def create_user():
            return {}
      `),
    );
    const e = r[0];
    expect(e?.status).toBe(201);
    expect(e?.confidence).toBe("high");
    expect((e?.schema as { kind: "ref"; $ref: string }).$ref).toBe(
      "UserResponse",
    );
    expect(e?.reason).toContain("status_code=201");
  });

  test("(b) response_model without status_code → 200 high", () => {
    __setInferrersForTest([new FastApiResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @app.get("/users", response_model=UserResponse)
        async def list_users():
            return []
      `),
    );
    expect(r[0]?.status).toBe(200);
    expect(r[0]?.confidence).toBe("high");
    expect((r[0]?.schema as { kind: "ref"; $ref: string }).$ref).toBe(
      "UserResponse",
    );
  });

  test("(c) return type annotation → 200 medium", () => {
    __setInferrersForTest([new FastApiResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @app.get("/users")
        async def list_users() -> UserResponse:
            return {}
      `),
    );
    const e = r[0];
    expect(e?.status).toBe(200);
    expect(e?.confidence).toBe("medium");
    expect((e?.schema as { kind: "ref"; $ref: string }).$ref).toBe(
      "UserResponse",
    );
    expect(e?.reason).toContain("UserResponse");
  });

  test("(c.2) PascalCase guard: lowercase return type is ignored", () => {
    __setInferrersForTest([new FastApiResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @app.get("/x")
        async def handler() -> dict:
            return {}
      `),
    );
    expect(r).toHaveLength(0);
  });

  test("(d) source from a non-fastapi framework is ignored", () => {
    __setInferrersForTest([new FastApiResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @app.get("/x", response_model=X)
        async def h() -> X: return {}
      `, "express"),
    );
    expect(r).toHaveLength(0);
  });
});
