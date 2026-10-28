import express from "express";

const app = express();

app.get("/health", (req, res) => res.json({ ok: true, service: "orders" }));
app.get("/api/orders", (req, res) => res.json([]));
app.post("/api/orders", (req, res) => res.status(201).json({}));
app.get("/api/orders/:id", (req, res) => res.json({}));

export default app;
