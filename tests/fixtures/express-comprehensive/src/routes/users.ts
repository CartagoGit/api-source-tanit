import { Router } from "express";
import { z } from "zod";

const userRouter = Router();

// zod schema for user creation
const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(120),
  role: z.enum(["admin", "user", "guest"]).default("user"),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

// List users
userRouter.get("/", (_req, res) => {
  res.json([]);
});

// Create user
userRouter.post("/", (req, res) => {
  const parsed = createUserSchema.parse(req.body);
  res.json({ id: 1, ...parsed });
});

// Show user
userRouter.get("/:id", (req, res) => {
  res.json({ id: req.params.id });
});

// Update user
userRouter.put("/:id", (req, res) => {
  const parsed = updateUserSchema.parse(req.body);
  res.json({ id: req.params.id, ...parsed });
});

// Delete user
userRouter.delete("/:id", (req, res) => {
  res.json({ deleted: req.params.id });
});

// Update user address (nested object)
const addressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  country: z.string().length(2),
  postalCode: z.string().regex(/^\d{5}$/),
});

userRouter.put("/:id/address", (req, res) => {
  const parsed = addressSchema.parse(req.body);
  res.json({ id: req.params.id, address: parsed });
});

export { userRouter };