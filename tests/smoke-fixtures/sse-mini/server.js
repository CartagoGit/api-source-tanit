// Minimal SSE source — the scanner emits one route per
// `app.get('/events', …)` handler that writes `text/event-stream`.
import express from "express";

const app = express();

app.get("/events", (req, res) => {
  res.set("Content-Type", "text/event-stream");
  res.write("event: tick\ndata: {}\n\n");
});

app.get("/stream", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write("data: hello\n\n");
});
