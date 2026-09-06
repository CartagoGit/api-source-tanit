import express from "express";

const router = express.Router();

router.get("/history", (_req, res) => {
  res.json({ from: "orders" });
});

router.post("/checkout", (_req, res) => {
  res.json({ from: "orders", created: true });
});

export { router as ordersRouter };
