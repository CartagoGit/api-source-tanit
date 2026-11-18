/**
 * Sample WebSocket app (audit 2026-09-06 §11, proposal `f00013` S3).
 */
import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => { /* inbound */ });
  ws.on("close",   ()   => { /* inbound */ });
  ws.send(JSON.stringify({ kind: "ready" }));
});
