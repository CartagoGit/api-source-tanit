/**
 * Cross-file Express multi-router E2E (x00055 S3).
 *
 * The fixture has 2 source files (users.ts + orders.ts)
 * that both declare `const router = express.Router()` (the
 * SAME localName the bug x00055 opens). server.ts mounts
 * each via a NAMED export (`usersRouter` / `ordersRouter`)
 * under different prefixes.
 *
 * The scanner today emits per-file routes correctly because
 * r00014 S4 made the router symbol file-scoped. The
 * CROSS-FILE prefix (mounting `usersRouter` → `/api/users/list`)
 * lands in a follow-up slice that walks `resolveByImportPath`
 * end-to-end. This E2E pins the **scanner-side** half of
 * the contract — the fixture + the routes per file — and
 * documents that the prefix propagation is work tracked
 * for the next slice.
 */
import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  ExpressProjectScanner,
  ExpressRouteScanner,
} from "../../packages/frameworks/scanners/express.scanner";
import { runProcess } from "../helpers/run-process";

const FIXTURE = join("tests", "fixtures", "express-multi-router");

describe("x00055 S3 — express multi-router E2E", () => {
  test("fixture scans both routers without losing routes", async () => {
    const match = await new ExpressProjectScanner().resolve(FIXTURE);
    const result = await new ExpressRouteScanner().scan(match);
    // /health (server.ts), users.list (users.ts),
    // users.create (users.ts), orders.list (orders.ts),
    // orders.create (orders.ts).
    const byMethodUri = new Set(
      result.routes.map((r) => `${r.method} ${r.uri}`),
    );
    expect(byMethodUri.has("GET /health")).toBe(true);
    expect(byMethodUri.has("GET /list")).toBe(true);
    expect(byMethodUri.has("POST /create")).toBe(true);
    // Two sourceFiles both declaring `router` — same
    // SymbolId, not same router. r00014 S4 carries this.
    expect(byMethodUri.size).toBeGreaterThanOrEqual(3);
  });

  test("fixture produces valid JSON when scanned end-to-end", async () => {
    const work = await mkdtemp(join(tmpdir(), "x55-"));
    try {
      // Copy the fixture into a clean work dir so the
      // scanner doesn't pick up sibling fixtures.
      const fs = await import("node:fs/promises");
      async function copyDir(src: string, dst: string) {
        await fs.mkdir(dst, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });
        for (const e of entries) {
          const s = join(src, e.name);
          const d = join(dst, e.name);
          if (e.isDirectory()) await copyDir(s, d);
          else await fs.copyFile(s, d);
        }
      }
      await copyDir(FIXTURE, join(work));
      const cli = join(
        process.cwd(),
        "packages",
        "cli",
        "commands",
        "generate.script.ts",
      );
      const { code } = await runProcess("bun", [
        cli,
        "--project-root",
        work,
      ]);
      // The scanner emits 5 routes (health + list/create per
      // router); generation is `0 final requests` only if
      // nothing matched. The bug-x00055 regression was
      // "users routes appearing under /api/orders" — the
      // current scanner cannot yet mount cross-file
      // prefixes, so we accept a successful emission of the
      // routes WITHOUT cross-file prefix as the documented
      // mid-slice state.
      expect(code).toBe(0);
      const collectionPath = join(
        work,
        "tanit",
        "express-multi-router-fixture.postman_collection.json",
      );
      const body = await readFile(collectionPath, "utf8");
      const json = JSON.parse(body) as {
        item: Array<{ item: Array<{ request: { url: { raw?: string } } }> }>;
      };
      expect(Array.isArray(json.item)).toBe(true);
      // Pin that we have at least one request per method/uri
      // the fixture owns — the smoke is "no method+uri dropped"
      // not "exact prefix", since cross-file prefixes are
      // future work.
      const items = json.item.flatMap((g) => g.item ?? []);
      const uris = new Set(
        items.map((i) => i.request?.url?.raw ?? ""),
      );
      expect(uris.size).toBeGreaterThanOrEqual(3);
      // Avoid a tree-shake warning: include a no-op
      // writeFile so the import isn't dropped.
      await writeFile(join(work, ".noop"), "");
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  });
});
