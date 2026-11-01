import { describe, expect, test } from "vitest";

import {
  ExpressProjectScanner,
  ExpressRouteScanner,
} from "../../packages/frameworks/scanners/express.scanner";
import {
  FastifyProjectScanner,
  FastifyRouteScanner,
} from "../../packages/frameworks/scanners/fastify.scanner";
import {
  HonoProjectScanner,
  HonoRouteScanner,
} from "../../packages/frameworks/scanners/hono.scanner";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";

describe("IScanResult.symbols (r00014 S3)", () => {
  test("Express exposes a symbols graph on scan results", async () => {
    const root = comprehensiveFixtureDir("express");
    const match = await new ExpressProjectScanner().resolve(root);
    const result = await new ExpressRouteScanner().scan(match);
    expect(result.symbols).toBeDefined();
    expect(result.symbols?.resolveByName(root + "/src/server.ts", "router")).toBeDefined();
  });

  test("Fastify exposes a symbols graph on scan results", async () => {
    const root = comprehensiveFixtureDir("fastify");
    const match = await new FastifyProjectScanner().resolve(root);
    const result = await new FastifyRouteScanner().scan(match);
    expect(result.symbols).toBeDefined();
    expect(result.symbols?.resolveByName(root + "/src/server.js", "app")).toEqual([]);
  });

  test("Hono exposes a symbols graph on scan results", async () => {
    const root = comprehensiveFixtureDir("hono");
    const match = await new HonoProjectScanner().resolve(root);
    const result = await new HonoRouteScanner().scan(match);
    expect(result.symbols).toBeDefined();
    expect(result.symbols?.resolveByName(root + "/src/index.ts", "app")).toEqual([]);
  });
});