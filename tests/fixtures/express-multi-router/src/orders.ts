/**
 * Cross-file Express router fixture — orders router.
 *
 * Same `router` localName as users.ts. The scanner must
 * discriminate per file (SymbolId-aware, see r00014 S4 /
 * x00055 S3).
 */
import express from "express";

const router = express.Router();

router.get("/list", (_req, res) => {
  res.json({ from: "orders", items: [] });
});

router.post("/create", (_req, res) => {
  res.json({ from: "orders", id: 100 });
});

export { router as ordersRouter };
