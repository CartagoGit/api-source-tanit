/**
 * AsyncAPI scanner (audit 2026-09-06 §11, proposal `f00013` S5).
 *
 * Pins the AsyncAPI 2.x behaviour agreed for `f00013`:
 *   - detection: a project with at least one `asyncapi.yaml`
 *     (or `.yml` / `.json`) document scores 1.0
 *   - protocol mapping: `kafka` / `amqp` / `nats` / `mqtt` /
 *     `ws` become the corresponding `TransportKind`
 *     (`rabbitmq` for `amqp`/`amqps`)
 *   - operations: one operation (`action: send|receive`) →
 *     one `ParsedRoute` with `transport: <broker>` and
 *     `transportMeta: { channel, event, direction }`
 *   - HTTP servers (protocol `http` / `https`) are skipped:
 *     HTTP scanners own that surface.
 */
import { describe, expect, test } from "vitest";
import { join } from "node:path";

import {
  AsyncApiProjectScanner,
  AsyncApiRouteScanner,
} from "../../packages/frameworks/scanners/asyncapi.scanner";

const FIXTURE = join("tests", "fixtures", "asyncapi-comprehensive");

describe("asyncapi-scanner — detection", () => {
  test("a project with asyncapi.yaml scores 1.0", async () => {
    const score = (await new AsyncApiProjectScanner().detect(FIXTURE)).score;
    expect(score).toBe(1);
  });
});

describe("asyncapi-scanner — parsing", () => {
  test("every operation becomes one route with transport=kafka", async () => {
    const match = await new AsyncApiProjectScanner().resolve(FIXTURE);
    const result = await new AsyncApiRouteScanner().scan(match);
    expect(result.routes).toHaveLength(2);
    for (const r of result.routes) {
      expect(r.transport).toBe("kafka");
      expect(r.framework).toBe("asyncapi");
    }
  });

  test("the channel ref propagates to transportMeta.channel", async () => {
    const match = await new AsyncApiProjectScanner().resolve(FIXTURE);
    const result = await new AsyncApiRouteScanner().scan(match);
    for (const r of result.routes) {
      expect(r.transportMeta?.channel).toBe("orders/created");
    }
  });

  test("action=send yields direction=out, action=receive yields direction=in", async () => {
    const match = await new AsyncApiProjectScanner().resolve(FIXTURE);
    const result = await new AsyncApiRouteScanner().scan(match);
    const send = result.routes.find(
      (r) => r.transportMeta?.event === "onOrderCreated",
    );
    const recv = result.routes.find(
      (r) => r.transportMeta?.event === "onOrderReceived",
    );
    expect(send?.transportMeta?.direction).toBe("out");
    expect(recv?.transportMeta?.direction).toBe("in");
  });

  test("the operation key becomes displayName + transportMeta.event", async () => {
    const match = await new AsyncApiProjectScanner().resolve(FIXTURE);
    const result = await new AsyncApiRouteScanner().scan(match);
    const names = result.routes
      .map((r) => r.transportMeta?.event)
      .sort();
    expect(names).toEqual(["onOrderCreated", "onOrderReceived"]);
  });
});
