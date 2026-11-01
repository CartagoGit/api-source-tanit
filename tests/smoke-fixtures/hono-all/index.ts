/**
 * Hono mini-fixture for `x00056 S4` — exercises the `app.all()`
 * sentinel that commit `aad6376` emits as `method: "ALL"`.
 *
 * This fixture exists so that:
 *
 *   - `lint:fixtures` sees a real manifest + a real source file
 *     (not just `package.json` and `expected.json`).
 *   - The scanner contract for Hono has an `.all()` example that the
 *     fixtures gate can reason about (audit 2026-09-06 §1: bare
 *     fixtures in `develop` ship 0 routes and break coverage
 *     silently).
 *
 * The expected scan output lives in `expected.json`: one route with
 * `method: "ALL"` on `/anything`. The fixture is intentionally small
 * (no other endpoints) so the contract is unambiguous.
 */
import { Hono } from "hono";
const app = new Hono();
app.all("/anything", (c) => c.json({ ok: true }));
export default app;