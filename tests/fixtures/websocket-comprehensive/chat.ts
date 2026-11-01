/**
 * WebSocket fixture exercising three flavours at once:
 *   1. Socket.IO: `socket.on(...)` / `socket.emit(...)` / `io.of('/admin')`
 *   2. `ws`: `wss.on(...)` / `ws.send(...)`
 *   3. Native `WebSocket`: `addEventListener('message', ...)`.
 *
 * The scanner reads lines, so all event handlers live on a
 * single line each (multi-line `addEventListener` blocks
 * still fire because the marker `("evt")` lives somewhere on
 * a single source line).
 */
import { io } from "socket.io";
import { WebSocketServer } from "ws";

// 1. Socket.IO — default namespace
io.on("connection", (socket) => {
  socket.on("message", (payload) => { /* inbound */ });
  socket.on("typing",  (payload) => { /* inbound */ });
  socket.emit("chat",     { room: "lobby", text: "hi" });
  socket.emit("presence", { user: "u1", status: "online" });
});

// 2. Socket.IO — admin namespace
io.of("/admin").on("connection", (socket) => {
  socket.on("ban",   (id) => { /* inbound, namespace=/admin */ });
  socket.emit("audit", { at: Date.now() });
});

// 3. `ws` — raw WebSocket server
const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws) => {
  ws.on("message", (raw) => { /* inbound */ });
  ws.send(JSON.stringify({ kind: "ready" }));
});

// 4. Browser-side `WebSocket` constructor
const client = new WebSocket("ws://localhost:8080");
client.addEventListener("message", (ev) => { /* inbound */ });
client.addEventListener("open",    ()  => { /* inbound */ });
