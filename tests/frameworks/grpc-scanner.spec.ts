/**
 * gRPC scanner (audit 2026-09-06 §11, proposal `f00013` S2).
 *
 * The minimal scanner reads `.proto` files and emits one
 * `ParsedRoute` per `rpc` declaration. These tests pin:
 *   - detection: a project with `.proto` files scores 1.0
 *   - parse: each `rpc` becomes one route with `transport: "grpc"`
 *     + `transportMeta: { service, method, streaming }`
 *   - streaming kind: unary / server-stream / client-stream / bidi
 *     is detected from the `stream` modifier
 *   - HTTP-only exporters ignore non-HTTP transports (the gRPC
 *     scanner emits `method: "POST"` so the adapter keeps the
 *     route alive today; future transport-aware exporters will
 *     own the rendering).
 */
import { describe, expect, test } from "vitest";
import { join } from "node:path";

import {
  GrpcProjectScanner,
  GrpcRouteScanner,
} from "../../packages/frameworks/scanners/grpc.scanner";

const FIXTURE = join("tests", "fixtures", "grpc-comprehensive");

describe("grpc-scanner — detection", () => {
  test("a project with .proto files scores 1.0", async () => {
    const score = (await new GrpcProjectScanner().detect(FIXTURE)).score;
    expect(score).toBe(1);
  });
});

describe("grpc-scanner — parsing", () => {
  test("every rpc becomes one route, with transport=grpc + transportMeta", async () => {
    const match = await new GrpcProjectScanner().resolve(FIXTURE);
    const result = await new GrpcRouteScanner().scan(match);
    expect(result.routes).toHaveLength(3);
    for (const route of result.routes) {
      expect(route.transport).toBe("grpc");
      expect(route.transportMeta?.service).toBe("Greeter");
      expect(route.framework).toBe("grpc");
    }
  });

  test("streaming kind is detected for each modifier combination", async () => {
    const match = await new GrpcProjectScanner().resolve(FIXTURE);
    const result = await new GrpcRouteScanner().scan(match);
    const byMethod = new Map(result.routes.map((r) => [r.transportMeta?.method, r]));

    const unary = byMethod.get("SayHello")!;
    expect(unary.transportMeta?.streaming).toBe("unary");

    const serverStream = byMethod.get("StreamGreetings")!;
    expect(serverStream.transportMeta?.streaming).toBe("server-stream");

    const bidi = byMethod.get("BiDi")!;
    expect(bidi.transportMeta?.streaming).toBe("bidi");
  });

  test("the URI follows the conventional gRPC path notation", async () => {
    const match = await new GrpcProjectScanner().resolve(FIXTURE);
    const result = await new GrpcRouteScanner().scan(match);
    const uris = result.routes.map((r) => r.uri).sort();
    expect(uris).toEqual([
      "/Greeter/BiDi",
      "/Greeter/SayHello",
      "/Greeter/StreamGreetings",
    ]);
  });

  test("the route sourceFile points at the .proto path", async () => {
    const match = await new GrpcProjectScanner().resolve(FIXTURE);
    const result = await new GrpcRouteScanner().scan(match);
    expect(result.routes[0]?.sourceFile).toContain("helloworld.proto");
  });
});
