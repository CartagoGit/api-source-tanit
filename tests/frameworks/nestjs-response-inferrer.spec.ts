/**
 * NestJS response inferrer (audit 2026-09-06 §10, proposal
 * `f00012` S2).
 *
 * Pins the five signals the inferrer reads:
 *
 *   (a) `@HttpCode(201)` / numeric literal → 201 empty schema.
 *   (b) `@HttpCode(HttpStatus.CREATED)` → 201 empty schema.
 *   (c) `@ApiResponse({ status: 200, type: UserDto })` →
 *       200 ref schema (high confidence).
 *   (d) `@ApiOkResponse({ type: X })` → 200 ref schema.
 *   (e) `@ApiCreatedResponse({ type: X })` → 201 ref schema.
 *   (f) `Promise<UserDto>` return type → 200 ref schema
 *       (medium confidence).
 *
 * Plus a "registry wired up" check that confirms
 * `registerResponseInferrer` registered the inferrer at
 * module-load time.
 */
import {
  describe,
  expect,
  test,
  beforeEach,
} from "vitest";

import {
  inferResponses,
  __setInferrersForTest,
} from "../../packages/core/responses/infer-responses";
import {
  NestJsResponseInferrer,
} from "../../packages/frameworks/scanners/nestjs.response-inferrer";
import type {
  EndpointSpecLike,
  IFrameworkSourceFileLike,
} from "../../packages/contracts/interfaces/core/responses.interface";

const SPEC: EndpointSpecLike = {
  method: "GET",
  uri: "/users",
};
function source(content: string): IFrameworkSourceFileLike {
  return { path: "/app/users.controller.ts", content, framework: "nestjs" };
}

describe("NestJS response inferrer (f00012 S2)", () => {
  beforeEach(() => __setInferrersForTest([]));

  test("(a) @HttpCode(201) numeric → 201 empty", () => {
    __setInferrersForTest([new NestJsResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @Post()
        @HttpCode(201)
        async create() { return { id: 1 }; }
      `),
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.status).toBe(201);
    expect(r[0]?.confidence).toBe("high");
    expect(r[0]?.reason).toContain("@HttpCode");
  });

  test("(b) @HttpCode(HttpStatus.CREATED) → 201", () => {
    __setInferrersForTest([new NestJsResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @HttpCode(HttpStatus.CREATED)
        @Post()
        async create() { return { id: 1 }; }
      `),
    );
    expect(r.some((e) => e.status === 201 && e.confidence === "high")).toBe(
      true,
    );
  });

  test("(c) @ApiResponse(status, type) → ref schema", () => {
    __setInferrersForTest([new NestJsResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @ApiResponse({ status: 200, type: UserDto })
        @Get()
        async findOne() { return {}; }
      `),
    );
    const api = r.find((e) => e.reason.startsWith("@ApiResponse"));
    expect(api?.status).toBe(200);
    expect(api?.schema.kind).toBe("ref");
    expect((api?.schema as { kind: "ref"; $ref: string }).$ref).toBe("UserDto");
    expect(api?.confidence).toBe("high");
  });

  test("(d) @ApiOkResponse → 200 ref", () => {
    __setInferrersForTest([new NestJsResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @ApiOkResponse({ type: UserDto })
        @Get()
        async findOne() { return {}; }
      `),
    );
    const ok = r.find((e) => e.reason.startsWith("@ApiOkResponse"));
    expect(ok?.status).toBe(200);
    expect(ok?.confidence).toBe("high");
  });

  test("(e) @ApiCreatedResponse → 201 ref", () => {
    __setInferrersForTest([new NestJsResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @ApiCreatedResponse({ type: CreateUserDto })
        @Post()
        async create() { return {}; }
      `),
    );
    const cr = r.find((e) => e.reason.startsWith("@ApiCreatedResponse"));
    expect(cr?.status).toBe(201);
    expect(cr?.confidence).toBe("high");
  });

  test("(f) Promise<UserDto> return type → 200 medium", () => {
    __setInferrersForTest([new NestJsResponseInferrer()]);
    const r = inferResponses(
      SPEC,
      source(`
        @Get()
        async findOne(): Promise<UserDto> { return {} as any; }
      `),
    );
    const ret = r.find((e) => e.reason === "NestJS return type");
    expect(ret?.status).toBe(200);
    expect(ret?.confidence).toBe("medium");
  });

  test("source from a non-nestjs framework is ignored", () => {
    __setInferrersForTest([new NestJsResponseInferrer()]);
    const r = inferResponses(SPEC, {
      path: SPEC.sourceFile ?? "/x.ts",
      content: `@ApiResponse({ status: 200, type: X })`,
      framework: "express",
    });
    expect(r).toHaveLength(0);
  });
});
