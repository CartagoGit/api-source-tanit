/**
 * `extractFastifyRoutesFromIR` + `extractHonoRoutesFromIR`
 * tests (audit 2026-09-06 §12, proposal `r00013` S1+S2).
 *
 * The IR feeders here are hand-built `IRouteCallExpression[]`
 * — no Babel needed for these tests. Each case verifies
 * one shape the proposal explicitly calls out.
 */
import { describe, expect, test } from "vitest";

import {
  extractFastifyRoutesFromIR,
} from "../../packages/core/language-frontends/typescript/extract-routes-fastify.helper";
import {
  extractHonoRoutesFromIR,
} from "../../packages/core/language-frontends/typescript/extract-routes-hono.helper";
import {
  extractRoutes,
} from "../../packages/core/language-frontends/typescript";
import type { IExtractedRoute } from "../../packages/core/language-frontends/typescript";
import type {
  IImportBinding,
  IRouteCallExpression,
} from "../../packages/contracts/interfaces/core/language-ir.interface";

const FILE = "/app/server.ts";

/** Convenience: build a verb call with the IR shape. */
function mkCall(
  callee: string,
  method: string,
  receiver: string | undefined,
  args: ReadonlyArray<{ kind: string; value?: unknown; identifierName?: string; objectShape?: ReadonlyArray<{ key: string; literal: { kind: string; value: unknown } }> }>,
): IRouteCallExpression {
  return {
    callee,
    receiverKind: "identifier",
    receiver,
    method,
    args: args as unknown as IRouteCallExpression["args"],
    range: { file: FILE, start: 10, end: 30 },
  };
}

const FASTIFY_BINDING: IImportBinding = {
  name: "fastify",
  importedName: "default",
  source: "fastify",
  range: { file: FILE, start: 0, end: 0 },
};

const HONO_BINDING: IImportBinding = {
  name: "Hono",
  importedName: "Hono",
  source: "hono",
  range: { file: FILE, start: 0, end: 0 },
};

function expectRealRange(route: IExtractedRoute | undefined) {
  expect(route?.range.file).toBe(FILE);
  expect((route?.range.end ?? 0) > (route?.range.start ?? 0)).toBe(true);
}

describe("extractFastifyRoutesFromIR (r00013 S1)", () => {
  test("verb shorthand emits one route per verb call", () => {
    const calls = [
      mkCall("fastify.get", "get", "fastify", [
        { kind: "string", value: "/users" },
        { kind: "identifier", identifierName: "listUsers" },
      ]),
    ];
    const { routes } = extractFastifyRoutesFromIR(
      calls,
      [FASTIFY_BINDING],
      FILE,
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]?.method).toBe("GET");
    expect(routes[0]?.path).toBe("/users");
    expect(routes[0]?.receiver).toBe("fastify");
    expectRealRange(routes[0]);
  });

  test(".route({method, url}) object form", () => {
    const calls = [
      mkCall("fastify.route", "route", "fastify", [
        {
          kind: "object",
          objectShape: [
            { key: "method", literal: { kind: "string", value: "GET" } },
            { key: "url", literal: { kind: "string", value: "/x" } },
          ],
        },
      ]),
    ];
    const { routes } = extractFastifyRoutesFromIR(
      calls,
      [FASTIFY_BINDING],
      FILE,
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]?.method).toBe("GET");
    expect(routes[0]?.path).toBe("/x");
    expectRealRange(routes[0]);
  });

  test(".register(plugin, {prefix}) → IRouterMount", () => {
    const calls = [
      mkCall("fastify.register", "register", "fastify", [
        { kind: "identifier", identifierName: "usersPlugin" },
        {
          kind: "object",
          objectShape: [
            { key: "prefix", literal: { kind: "string", value: "/v1" } },
          ],
        },
      ]),
    ];
    const { routes, mounts } = extractFastifyRoutesFromIR(
      calls,
      [FASTIFY_BINDING],
      FILE,
    );
    expect(routes).toHaveLength(0);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]?.plugin).toBe("usersPlugin");
    expect(mounts[0]?.prefix).toBe("/v1");
    expect((mounts[0]?.range.end ?? 0) > (mounts[0]?.range.start ?? 0)).toBe(true);
  });

  test("non-fastify receiver is filtered out", () => {
    const calls = [
      mkCall("app.get", "get", "app", [
        { kind: "string", value: "/x" },
      ]),
    ];
    const { routes } = extractFastifyRoutesFromIR(
      calls,
      [
        {
          name: "app",
          importedName: "default",
          source: "express",
          range: { file: FILE, start: 0, end: 0 },
        },
      ],
      FILE,
    );
    expect(routes).toHaveLength(0);
  });

  test("alias via importedName is honoured", () => {
    const calls = [
      mkCall("F.get", "get", "F", [
        { kind: "string", value: "/x" },
      ]),
    ];
    const { routes } = extractFastifyRoutesFromIR(
      calls,
      [
        {
          name: "F",
          importedName: "default",
          source: "fastify",
          range: { file: FILE, start: 0, end: 0 },
        },
      ],
      FILE,
    );
    expect(routes).toHaveLength(1);
  });
});

describe("extractHonoRoutesFromIR (r00013 S2)", () => {
  test("verb shorthand on a Hono receiver", () => {
    const calls = [
      mkCall("Hono.get", "get", "Hono", [
        { kind: "string", value: "/a" },
        { kind: "identifier", identifierName: "handlerA" },
      ]),
    ];
    const { routes } = extractHonoRoutesFromIR(
      calls,
      [HONO_BINDING],
      FILE,
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]?.method).toBe("GET");
    expect(routes[0]?.path).toBe("/a");
    expectRealRange(routes[0]);
  });

  test(".route('/api', subApp) → IRouterMount with subApp name + prefix", () => {
    const calls = [
      mkCall("Hono.route", "route", "Hono", [
        { kind: "string", value: "/api" },
        { kind: "identifier", identifierName: "sub" },
      ]),
    ];
    const { routes, mounts } = extractHonoRoutesFromIR(
      calls,
      [HONO_BINDING],
      FILE,
    );
    expect(routes).toHaveLength(0);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]?.plugin).toBe("sub");
    expect(mounts[0]?.prefix).toBe("/api");
    expect((mounts[0]?.range.end ?? 0) > (mounts[0]?.range.start ?? 0)).toBe(true);
  });

  test(".all() route carries the verb", () => {
    const calls = [
      mkCall("Hono.all", "all", "Hono", [
        { kind: "string", value: "/anything" },
      ]),
    ];
    const { routes } = extractHonoRoutesFromIR(
      calls,
      [HONO_BINDING],
      FILE,
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]?.method).toBe("ALL");
    expectRealRange(routes[0]);
  });

  test("non-hono receiver is filtered out", () => {
    const calls = [
      mkCall("app.get", "get", "app", [
        { kind: "string", value: "/x" },
      ]),
    ];
    const { routes } = extractHonoRoutesFromIR(
      calls,
      [
        {
          name: "app",
          importedName: "default",
          source: "fastify",
          range: { file: FILE, start: 0, end: 0 },
        },
      ],
      FILE,
    );
    expect(routes).toHaveLength(0);
  });
});

describe("extractRoutes (r00013 S3)", () => {
  test("dispatches Fastify source through the unified API", () => {
    const source = [
      'import fastify from "fastify";',
      'const app = fastify();',
      'app.get("/health", handler);',
    ].join("\n");
    const result = extractRoutes(source, FILE, "fastify");
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.method).toBe("GET");
    expect(result.routes[0]?.path).toBe("/health");
    expectRealRange(result.routes[0]);
  });

  test("dispatches Hono source through the unified API", () => {
    const source = [
      'import { Hono } from "hono";',
      'const app = new Hono();',
      'app.all("/any", handler);',
    ].join("\n");
    const result = extractRoutes(source, FILE, "hono");
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.method).toBe("ALL");
    expect(result.routes[0]?.path).toBe("/any");
    expectRealRange(result.routes[0]);
  });

  test("dispatches Express source through the unified API", () => {
    const source = [
      'import express from "express";',
      'const app = express();',
      'app.get("/health", handler);',
      'const router = express.Router();',
      'app.use("/api", router);',
    ].join("\n");
    const result = extractRoutes(source, FILE, "express");
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.method).toBe("GET");
    expect(result.mounts).toHaveLength(1);
    expect(result.mounts[0]?.prefix).toBe("/api");
    expectRealRange(result.routes[0]);
  });
});
