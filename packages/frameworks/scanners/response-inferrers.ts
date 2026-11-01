/**
 * Response-inferrer registration barrel (proposal `f00012`, wiring).
 *
 * Each framework inferrer self-registers when its module is imported
 * (`registerResponseInferrer(new XResponseInferrer())` at module
 * level), but side effects only run if **someone imports the module**.
 * Until now nobody in production did, so the dispatcher's registry
 * stayed empty and `inferResponses()` always returned `[]` — the whole
 * feature was dead code.
 *
 * This barrel is that "someone": a single import point for the four
 * inferrer modules plus an idempotent guard so consumers (CLI, future
 * MCP/UI surfaces) can call `ensureResponseInferrersRegistered()` from
 * a hot path without re-walking the imports.
 *
 * Placement: `packages/frameworks/` on purpose. The inferrers live
 * next to their scanners (they read framework sources), and `core`
 * must never import from `frameworks` (`lint:boundaries`) — so the
 * composition edge has to live on this side of the line.
 */
import { listRegisteredInferrers } from "../../core/responses/infer-responses";

// Side-effect imports: each module self-registers on load.
import "./spring.response-inferrer";
import "./nestjs.response-inferrer";
import "./fastapi.response-inferrer";
import "./aspnet.response-inferrer";

let registered = false;

/**
 * Idempotent registration guard.
 *
 * Importing the four inferrer modules runs their self-registrations;
 * this function only exists so callers have an explicit, readable
 * hook (and so tests can assert the registry is populated through the
 * same path production uses). Returns the number of registered
 * inferrers.
 */
export function ensureResponseInferrersRegistered(): number {
  if (!registered) {
    registered = true;
  }
  return listRegisteredInferrers().length;
}
