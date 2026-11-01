import { describe, test, beforeEach } from "vitest";
import { __setInferrersForTest, inferResponses } from "../../packages/core/responses/infer-responses";
import "../../packages/frameworks/scanners/fastapi.response-inferrer";
import { FastApiResponseInferrer } from "../../packages/frameworks/scanners/fastapi.response-inferrer";

describe("debug", () => {
  beforeEach(() => __setInferrersForTest([]));
  test("(b) debug", () => {
    __setInferrersForTest([new FastApiResponseInferrer()]);
    const r = inferResponses(
      { method: "GET", uri: "/x" },
      { path: "/x.py", framework: "fastapi", content: `
        @app.get("/users", response_model=UserResponse)
        async def list_users():
            return []
      ` }
    );
    console.log("got:", JSON.stringify(r, null, 2));
  });
});
