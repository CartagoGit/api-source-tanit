/**
 * Sample Express app exercising zod + Joi validation providers.
 *
 * - zod schemas for /users/* and /orders/*
 * - Joi schemas for /auth/*
 * - Custom headers via `headers: z.object({...})` for /orders
 */
import express from "express";
import Joi from "joi";
import { z } from "zod";

const app = express();
app.use(express.json());

// --- zod schemas ---

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(120).optional(),
  role: z.enum(["admin", "user", "guest"]).default("user"),
});

const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  age: z.number().int().min(0).max(120).optional(),
});

const ListUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

const CreateOrderSchema = z.object({
  customer_name: z.string().min(1),
  customer_email: z.string().email(),
  amount: z.number().int().positive(),
  items: z.array(z.string()).default([]),
});

const OrderHeadersSchema = z.object({
  "X-API-Key": z.string().min(32),
  "X-Request-Id": z.string().uuid().optional(),
});

// --- Joi schemas ---

const LoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
});

const RefreshSchema = Joi.object({
  refresh_token: Joi.string().min(32).required(),
});

// --- Routes ---

const router = express.Router();

router.get("/users", (req, res) => {
  const query = ListUsersQuerySchema.parse(req.query);
  res.json({ users: [], query });
});

router.post("/users", (req, res) => {
  const body = CreateUserSchema.parse(req.body);
  res.json({ id: 1, ...body });
});

router.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});

router.put("/users/:id", (req, res) => {
  const body = UpdateUserSchema.parse(req.body);
  res.json({ id: req.params.id, ...body });
});

router.delete("/users/:id", (req, res) => {
  res.json({ deleted: req.params.id });
});

router.post("/orders", (req, res) => {
  const headers = OrderHeadersSchema.parse(req.headers);
  const body = CreateOrderSchema.parse(req.body);
  res.json({ id: 1, headers, ...body });
});

router.get("/orders", (req, res) => {
  res.json({ orders: [] });
});

// --- auth router with Joi ---

const authRouter = express.Router();

authRouter.post("/auth/login", (req, res) => {
  const body = LoginSchema.validate(req.body);
  if (body.error) return res.status(400).json({ error: body.error.message });
  res.json({ token: "fake" });
});

authRouter.post("/auth/refresh", (req, res) => {
  const body = RefreshSchema.validate(req.body);
  if (body.error) return res.status(400).json({ error: body.error.message });
  res.json({ token: "fake" });
});

app.use("/api", router);
app.use("/api", authRouter);

app.listen(3000, () => console.log("Listening on :3000"));
