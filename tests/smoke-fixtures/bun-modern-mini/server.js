import express from "express";

const app = express();

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/users", (req, res) => res.json([]));
app.post("/api/users", (req, res) => res.json({}));
app.get("/api/users/:id", (req, res) => res.json({}));
app.delete("/api/users/:id", (req, res) => res.json({}));

app.listen(3000);
