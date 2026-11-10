/**
 * ASP.NET response inferrer tests (f00012 S4).
 *
 * Pins:
 *   (a) [ProducesResponseType(typeof(User), 200)] → 200 high.
 *   (b) [SwaggerResponse(200, typeof(User))] → 200 high.
 *   (c) [ProducesResponseType(201)] (no body) → 201, empty,
 *       medium.
 *   (d) source from a non-aspnet framework ignored.
 */
import { describe, expect, test, beforeEach } from "vitest";

import {
  inferResponses,
  __setInferrersForTest,
} from "../../packages/core/responses/infer-responses";
import {
  AspNetResponseInferrer,
} from "../../packages/frameworks/scanners/aspnet.response-inferrer";
import type {
  EndpointSpecLike,
  IFrameworkSourceFileLike,
} from "../../packages/contracts/interfaces/core/responses.interface";

const SPEC: EndpointSpecLike = { method: "GET", uri: "/x" };
function src(c: string, framework = "aspnet"): IFrameworkSourceFileLike {
  return { path: "/x.cs", framework, content: c };
}

describe("ASP.NET response inferrer (f00012 S4)", () => {
  beforeEach(() => __setInferrersForTest([]));

  test("(a) ProducesResponseType(typeof(User), 200) → 200 high", () => {
    __setInferrersForTest([new AspNetResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      src(`
        [HttpGet("/users")]
        [ProducesResponseType(typeof(UserDto), 200)]
        public ActionResult<UserDto> List() { return null; }
      `),
    );
    expect(r[0]?.status).toBe(200);
    expect(r[0]?.confidence).toBe("high");
    expect((r[0]?.schema as { kind: "ref"; $ref: string }).$ref).toBe(
      "UserDto",
    );
  });

  test("(b) SwaggerResponse(200, typeof(User)) → 200 high", () => {
    __setInferrersForTest([new AspNetResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      src(`
        [HttpGet("/users")]
        [SwaggerResponse(200, typeof(UserDto))]
        public ActionResult<UserDto> List() { return null; }
      `),
    );
    expect(r[0]?.status).toBe(200);
    expect(r[0]?.confidence).toBe("high");
  });

  test("(c) ProducesResponseType(201) without body → 201 medium", () => {
    __setInferrersForTest([new AspNetResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      src(`
        [HttpDelete("/users/{id}")]
        [ProducesResponseType(201)]
        public IActionResult Delete(string id) { return NoContent(); }
      `),
    );
    expect(r[0]?.status).toBe(201);
    expect(r[0]?.confidence).toBe("medium");
    expect(r[0]?.schema.kind).toBe("empty");
  });

  test("(d) source from a non-aspnet framework is ignored", () => {
    __setInferrersForTest([new AspNetResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      src(`[ProducesResponseType(typeof(X), 200)]`, "express"),
    );
    expect(r).toHaveLength(0);
  });
});
