/**
 * Cross-file Express router fixture — app entrypoint.
 *
 * Mounts `usersRouter` at `/api/users` and `ordersRouter` at
 * `/api/orders`. The ScannerPrefix bug x00055 opens would
 * conflate both routers into one prefix; the current
 * (post-r00014 S4) scanner keeps them separate.
 *
 * Note: `usersRouter` and `ordersRouter` are imported (not
 * declared here) — a true cross-file consumer. The
 * SymbolGraph that r00014 S1 introduced captures this so
 * future consumers can resolve by `SymbolId`, not by
 * text name.
 */
import express from "express";
import { usersRouter } from "./users.js";
import { ordersRouter } from "./orders.js";

const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/users", usersRouter);
app.use("/api/orders", ordersRouter);

export default app;
