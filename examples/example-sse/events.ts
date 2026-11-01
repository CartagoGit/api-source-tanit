/**
 * Sample SSE app (audit 2026-09-06 §11, proposal `f00013` S4).
 */
import express from "express";

const app = express();

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  setInterval(
    () => res.write(`event: tick\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`),
    1000,
  );
});

export default app;
