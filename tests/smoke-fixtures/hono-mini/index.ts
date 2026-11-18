import { Hono } from "hono";
const app = new Hono();
app.get("/users", (c) => c.json([]));
app.post("/users", (c) => c.json({}, 201));
export default app;
