/**
 * SSE fixture exercising two flavours at once:
 *   1. Plain HTTP `app.get("/events", ...)` paired with
 *      `res.setHeader('Content-Type', 'text/event-stream')`
 *   2. Two named event markers (`tick`, `update`) and a
 *      single unnamed `data:` stream — the scanner should
 *      emit one default-marker route + one route per named
 *      event.
 */
import { EventEmitter } from "node:events";
import express from "express";

const app = express();
const ticker = new EventEmitter();

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  const onTick = () =>
    res.write(`event: tick\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  const onUpdate = () =>
    res.write(
      `event: update\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`,
    );
  ticker.on("tick", onTick);
  ticker.on("update", onUpdate);
  // Pure `data:` without a preceding `event:` — must be
  // picked up as the default-marker stream.
  setInterval(
    () => res.write(`data: ${JSON.stringify({ at: Date.now() })}\n\n`),
    1000,
  );
  req.on("close", () => {
    ticker.off("tick", onTick);
    ticker.off("update", onUpdate);
  });
});

app.get("/heartbeat", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.flushHeaders();
  res.write(`: heartbeat\n\n`);
});
