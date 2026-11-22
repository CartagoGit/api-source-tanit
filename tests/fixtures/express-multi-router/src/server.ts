import express from "express";
import { router as usersRouter } from "./users.js";
import { router as ordersRouter } from "./orders.js";

const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/users", usersRouter);
app.use("/api/orders", ordersRouter);

export default app;
