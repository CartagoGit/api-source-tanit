/**
 * WebSocket scanner (audit 2026-09-06 §11, proposal `f00013` S3).
 *
 * Pins the behaviour agreed for `f00013`:
 *   - detection: a project with at least one trigger idiom scores 1.0
 *   - parse: every `socket.on|emit` / `ws.on|send` / `addEventListener`
 *     call becomes one `ParsedRoute` with `transport: "ws"`
 *   - direction: `on` / `addEventListener` are "in"; `emit` / `send`
 *     are "out"
 *   - Socket.IO namespace: `io.of('/admin')` propagates to
 *     `transportMeta.namespace`
 */
import { describe, expect, test } from "vitest";
import { join } from "node:path";

import {
  WebSocketProjectScanner,
  WebSocketRouteScanner,
} from "../../packages/frameworks/scanners/websocket.scanner";

const FIXTURE = join("tests", "fixtures", "websocket-comprehensive");

describe("websocket-scanner — detection", () => {
  test("a project with ws event handlers scores 1.0", async () => {
    const score = (await new WebSocketProjectScanner().detect(FIXTURE)).score;
    expect(score).toBe(1);
  });
});

describe("websocket-scanner — parsing", () => {
  test("every ws event call becomes a route with transport=ws", async () => {
    const match = await new WebSocketProjectScanner().resolve(FIXTURE);
    const result = await new WebSocketRouteScanner().scan(match);
    expect(result.routes.length).toBeGreaterThanOrEqual(8);
    for (const route of result.routes) {
      expect(route.transport).toBe("ws");
      expect(route.framework).toBe("websocket");
    }
  });

  test("direction is derived from on|emit / addEventListener|send", async () => {
    const match = await new WebSocketProjectScanner().resolve(FIXTURE);
    const result = await new WebSocketRouteScanner().scan(match);
    const directions = result.routes.map((r) =>
      r.transportMeta?.direction,
    );
    expect(directions).toContain("in");
    expect(directions).toContain("out");
  });

  test("Socket.IO namespace is captured in transportMeta", async () => {
    const match = await new WebSocketProjectScanner().resolve(FIXTURE);
    const result = await new WebSocketRouteScanner().scan(match);
    const admin = result.routes.find(
      (r) => r.transportMeta?.event === "ban",
    );
    expect(admin).toBeDefined();
    expect(admin?.transportMeta?.namespace).toBe("/admin");
    expect(admin?.transportMeta?.direction).toBe("in");
  });

  test("URI follows the /ws[/namespace]/events/<event> convention", async () => {
    const match = await new WebSocketProjectScanner().resolve(FIXTURE);
    const result = await new WebSocketRouteScanner().scan(match);
    for (const route of result.routes) {
      const ev = route.transportMeta?.event;
      expect(ev).toBeTruthy();
      expect(route.uri).toContain(`/events/${ev}`);
    }
  });
});
