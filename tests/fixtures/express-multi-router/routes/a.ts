/**
 * Multi-router Express fixture — exercises the cross-file
 * router resolution bug the proposal `x00055` opened (and
 * `r00014 S4` adds the graph support for).
 *
 * Two source files **deliberately** declare a router with the
 * same local name \`router\`. The scanner's earlier varName-only
 * lookup collapsed both into one slot and lost a prefix.
 */
import { Router } from "express";

export const router = Router();

router.get("/list", (_req, res) => {
  res.json({ from: "a" });
});
