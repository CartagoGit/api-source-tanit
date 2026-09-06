/**
 * Spring response inferrer tests (f00012 S4).
 *
 * Pins:
 *   (a) @ApiResponses(@ApiResponse(code = 200, ...))
 *   (b) @ApiResponse(code = 201, response = CreateUserDTO.class)
 *   (c) ResponseEntity<UserDTO> return shape → medium
 *   (d) source from non-spring framework ignored
 *   (e) module-level RegExp state hygiene (run twice)
 */
import { describe, expect, test, beforeEach } from "vitest";

import {
  inferResponses,
  __setInferrersForTest,
} from "../../packages/core/responses/infer-responses";
import {
  SpringResponseInferrer,
} from "../../packages/frameworks/scanners/spring.response-inferrer";
import type {
  EndpointSpecLike,
  IFrameworkSourceFileLike,
} from "../../packages/contracts/interfaces/core/responses.interface";

const SPEC: EndpointSpecLike = { method: "GET", uri: "/x" };
function src(c: string, framework = "springboot"): IFrameworkSourceFileLike {
  return { path: "/x.java", framework, content: c };
}

describe("Spring response inferrer (f00012 S4)", () => {
  beforeEach(() => __setInferrersForTest([]));

  test("(a) @ApiResponse(code=200, response=UserDTO.class)", () => {
    __setInferrersForTest([new SpringResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      src(`
        @ApiResponses(value = {
          @ApiResponse(code = 200, message = "ok", response = UserDTO.class)
        })
        @GetMapping("/users")
        public UserDTO list() { return null; }
      `),
    );
    expect(r[0]?.status).toBe(200);
    expect(r[0]?.confidence).toBe("high");
    expect((r[0]?.schema as { kind: "ref"; $ref: string }).$ref).toBe(
      "UserDTO",
    );
  });

  test("(b) @ApiResponse(code=201) standalone", () => {
    __setInferrersForTest([new SpringResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      src(`
        @ApiResponse(code = 201, response = CreateUserDTO.class)
        @PostMapping("/users")
        public CreateUserDTO create(@RequestBody CreateUserDTO in) { return in; }
      `),
    );
    expect(r[0]?.status).toBe(201);
    expect(r[0]?.confidence).toBe("high");
  });

  test("(c) ResponseEntity<X> return type → medium", () => {
    __setInferrersForTest([new SpringResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      src(`
        @GetMapping("/users")
        public ResponseEntity<UserDTO> list() { return null; }
      `),
    );
    expect(r[0]?.status).toBe(200);
    expect(r[0]?.confidence).toBe("medium");
    expect((r[0]?.schema as { kind: "ref"; $ref: string }).$ref).toBe(
      "UserDTO",
    );
  });

  test("(d) source from a non-spring framework is ignored", () => {
    __setInferrersForTest([new SpringResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      src(`@ApiResponse(code = 200, response = X.class)`, "express"),
    );
    expect(r).toHaveLength(0);
  });

  test("(e) module-level RegExp state is isolated per call", () => {
    __setInferrersForTest([new SpringResponseInferrer()]);
    const source = src(`
      @ApiResponse(code = 200, response = UserDTO.class)
      @GetMapping("/x")
      public UserDTO list() { return null; }
    `);
    const first = inferResponses(SPEC, source);
    const second = inferResponses(SPEC, source);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.status).toBe(first[0]?.status);
  });
});
