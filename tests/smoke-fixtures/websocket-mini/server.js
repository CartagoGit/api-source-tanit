// Minimal WebSocket source — the scanner emits one route per
// `socket.on(...)` / `socket.emit(...)` pair it finds.
import { Server } from "socket.io";

const io = new Server(3000);

io.on("connection", (socket) => {
  socket.on("ping", (payload) => {
    socket.emit("pong", payload);
  });

  socket.on("message", (body) => {
    socket.emit("ack", body);
  });
});
