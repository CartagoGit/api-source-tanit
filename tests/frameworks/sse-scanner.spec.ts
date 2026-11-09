/**
 * SSE scanner (audit 2026-09-06 §11, proposal `f00013` S4).
 *
 * Pins the behaviour agreed for `f00013`:
 *   - detection: a project containing `text/event-stream`
 *     scores 1.0
 *   - parse: each path hosting an SSE handler becomes one
 *     default-marker route; each `event: <name>` writer
 *     becomes one named route
 *   - default-marker routes have `transportMeta.event == null`
 *   - every route carries `transport: "sse"`
 */
import { describe, expect, test } from "vitest";
import { join } from "node:path";

import {
  SseProjectScanner,
  SseRouteScanner,
} from "../../packages/frameworks/scanners/sse.scanner";

const FIXTURE = join("tests", "fixtures", "sse-comprehensive");

describe("sse-scanner — detection", () => {
  test("a project serving text/event-stream scores 1.0", async () => {
    const score = (await new SseProjectScanner().detect(FIXTURE)).score;
    expect(score).toBe(1);
  });
});

describe("sse-scanner — parsing", () => {
  test("every sse handler becomes a route with transport=sse", async () => {
    const match = await new SseProjectScanner().resolve(FIXTURE);
    const result = await new SseRouteScanner().scan(match);
    expect(result.routes.length).toBeGreaterThanOrEqual(2);
    for (const route of result.routes) {
      expect(route.transport).toBe("sse");
      expect(route.framework).toBe("sse");
    }
  });

  test("default-marker stream produces one route with eventName=null", async () => {
    const match = await new SseProjectScanner().resolve(FIXTURE);
    const result = await new SseRouteScanner().scan(match);
    const defaults = result.routes.filter(
      (r) => r.transportMeta?.event === undefined || r.transportMeta?.event === null,
    );
    expect(defaults.length).toBeGreaterThanOrEqual(1);
  });

  test("named event markers produce one route per event", async () => {
    const match = await new SseProjectScanner().resolve(FIXTURE);
    const result = await new SseRouteScanner().scan(match);
    const names = result.routes
      .map((r) => r.transportMeta?.event)
      .filter((e): e is string => typeof e === "string");
    expect(names).toContain("tick");
    expect(names).toContain("update");
  });

  test("URI is the original app.get path", async () => {
    const match = await new SseProjectScanner().resolve(FIXTURE);
    const result = await new SseRouteScanner().scan(match);
    const uris = result.routes.map((r) => r.uri).sort();
    expect(uris).toContain("/events");
  });
});
