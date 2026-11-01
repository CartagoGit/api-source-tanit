import express from "express";

const app = express();

app.get("/users", (_req, res) => {
  res.json({ id: 1, name: "Ada", email: "ada@example.com" });
});

app.post("/users", (_req, res) => {
  res.status(201).json({ id: 2, name: "Grace" });
});

app.get("/users/:id", (_req, res) => {
  const user = { id: 1, name: "Ada" };
  res.json(user);
});

app.get("/health", (_req, res) => {
  res.send("ok");
});

export default app;
