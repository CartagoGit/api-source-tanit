import { Router } from "express";
import Joi from "joi";

const orderRouter = Router();

// Joi schema for order creation
const createOrderSchema = Joi.object({
  customerName: Joi.string().required().min(1),
  customerEmail: Joi.string().email().required(),
  amount: Joi.number().integer().positive().required(),
  currency: Joi.string().valid("EUR", "USD", "GBP").default("EUR"),
});

// List orders
orderRouter.get("/", (_req, res) => {
  res.json([]);
});

// Create order
orderRouter.post("/", (req, res) => {
  const { error, value } = createOrderSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ id: 1, ...value });
});

// Show order
orderRouter.get("/:id", (req, res) => {
  res.json({ id: req.params.id });
});

// Update order status (Joi enum)
const updateStatusSchema = Joi.object({
  status: Joi.string().valid("pending", "paid", "shipped", "cancelled").required(),
});

orderRouter.patch("/:id/status", (req, res) => {
  const { error, value } = updateStatusSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ id: req.params.id, ...value });
});

export { orderRouter };