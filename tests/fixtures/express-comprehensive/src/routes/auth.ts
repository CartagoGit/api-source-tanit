import { Router } from "express";
import { z } from "zod";

const authRouter = Router();

// Login: zod schema referenced in handler
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.parse(req.body);
  res.json({ token: "fake", ...parsed });
});

// Refresh token
const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

authRouter.post("/refresh", (req, res) => {
  const parsed = refreshSchema.parse(req.body);
  res.json({ token: "fake", ...parsed });
});

// Logout
authRouter.post("/logout", (_req, res) => {
  res.json({ ok: true });
});

export { authRouter };