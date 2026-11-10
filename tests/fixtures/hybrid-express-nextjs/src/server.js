/**
 * El Express heredado. Sigue sirviendo la API vieja mientras las rutas
 * nuevas se escriben en Next.js.
 */
import express from "express";

const app = express();
app.use(express.json());

app.get("/api/legacy/users", (req, res) => res.json([]));
app.post("/api/legacy/users", (req, res) => res.status(201).json({}));
app.delete("/api/legacy/users/:id", (req, res) => res.status(204).end());

export default app;
