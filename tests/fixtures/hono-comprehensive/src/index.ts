/**
 * Hono API that exercises what distinguishes it from Express: chained
 * routes, mounting sub-apps with `route()`, and validation with
 * `@hono/zod-validator`.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(120).optional(),
  role: z.enum(["admin", "user", "guest"]),
});

const ListUsersQuery = z.object({
  page: z.number().int().min(1),
  search: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const app = new Hono();

app.route("/api", app);

// Chained: three routes in one expression.
app
  .get("/health", (c) => c.json({ ok: true }))
  .get("/status", (c) => c.json({ up: true }))
  .get("/version", (c) => c.json({ v: 1 }));

app.get("/users", zValidator("query", ListUsersQuery), (c) => c.json([]));
app.post("/users", zValidator("json", CreateUserSchema), (c) => c.json({}, 201));
app.get("/users/:id", (c) => c.json({ id: c.req.param("id") }));
app.put("/users/:id", (c) => c.json({}));
app.delete("/users/:id", (c) => c.body(null, 204));

app.post("/auth/login", zValidator("json", LoginSchema), (c) => c.json({ token: "jwt" }));

export default app;
