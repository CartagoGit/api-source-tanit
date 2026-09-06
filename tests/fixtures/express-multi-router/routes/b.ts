/**
 * Second file with a same-named \`router\` variable. The
 * scanner must register both as distinct SymbolNodes in the
 * SymbolGraph (one per sourceFile) even though the localName
 * collides.
 */
import { Router } from "express";

export const router = Router();

router.get("/list", (_req, res) => {
  res.json({ from: "b" });
});
