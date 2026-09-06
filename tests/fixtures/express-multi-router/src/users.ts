import express from "express";

const router = express.Router();

router.get("/profile", (_req, res) => {
  res.json({ from: "users" });
});

router.post("/invite", (_req, res) => {
  res.json({ from: "users", invited: true });
});

export { router as usersRouter };
