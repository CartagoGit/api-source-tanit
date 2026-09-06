/**
 * Cross-file Express router fixture — users router.
 *
 * (x00055 S3 + r00014 S4) the multi-router fixture is
 * designed to exercise the case where two `app.use`
 * mount two different routers that share a localName
 * (`router`) across files. Each file declares its own
 * `router` and `users.ts` exports a named binding
 * (`usersRouter`) consumed by `server.ts`.
 */
import express from "express";

const router = express.Router();

router.get("/list", (_req, res) => {
  res.json({ from: "users", items: [] });
});

router.post("/create", (_req, res) => {
  res.json({ from: "users", id: 1 });
});

export { router as usersRouter };
