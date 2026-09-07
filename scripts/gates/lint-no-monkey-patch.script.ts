#!/usr/bin/env bun
/**
 * lint:no-monkey-patch — c00010 S1.
 *
 * Fails the gate when any production file under
 * `packages/cli/commands/` or `packages/core/discovery/` (the two
 * modules that historically injected output by reassigning
 * `console.log` or `process.env.POSTMAN_*`) still does one of:
 *
 *   1. `console.log = ...` — reassigns the global.
 *   2. `process.env.POSTMAN_* = ...` — reassigns a process env var.
 *
 * The replacement contract is dependency injection via
 * `IOutputSink` and explicit override arguments on path helpers.
 * Tests may still patch the global via `vi.spyOn`; the gate
 * allows `.spec.ts` files (anything that ends in `.spec.ts` or
 * `.test.ts`).
 *
 * Mirrors `lint-tool-no-process.script.ts` (p00011) for the tools
 * surface; this one covers CLI + discovery, where the historical
 * monkey-patches actually lived.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOTS = [
  "packages/cli/commands",
  "packages/core/discovery",
] as const;

const TEST_SUFFIX = /\.spec\.ts$|\.test\.ts$/;
const FORBIDDEN = [
  /console\.log\s*=\s*(?!.*=>\s*\{\s*\}\s*$)/,
  /process\.env\.POSTMAN_[A-Z_]+\s*=\s/,
] as const;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly match: string;
}

async function* walk(dir: string): AsyncIterable<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith(".ts") && !TEST_SUFFIX.test(entry.name)) {
      yield full;
    }
  }
}

const violations: Violation[] = [];
for (const root of ROOTS) {
  try {
    await stat(root);
  } catch {
    continue;
  }
  for await (const file of walk(root)) {
    const content = await readFile(file, "utf8");
    const lines = content.split("\n");
    let inBlockComment = false;
    lines.forEach((line, idx) => {
      let code = line;
      if (inBlockComment) {
        const end = code.indexOf("*/");
        if (end < 0) return;
        code = code.slice(end + 2);
        inBlockComment = false;
      }
      const blockStart = code.indexOf("/*");
      if (blockStart >= 0) {
        const blockEnd = code.indexOf("*/", blockStart + 2);
        if (blockEnd >= 0) {
          code = code.slice(0, blockStart) + code.slice(blockEnd + 2);
        } else {
          code = code.slice(0, blockStart);
          inBlockComment = true;
        }
      }
      code = code.replace(/\/\/.*$/, "");
      if (code.trim().length === 0) return;
      for (const pattern of FORBIDDEN) {
        const m = code.match(pattern);
        if (m) {
          violations.push({
            file: relative(process.cwd(), file),
            line: idx + 1,
            match: m[0],
          });
        }
      }
    });
  }
}

if (violations.length === 0) {
  console.log(`lint:no-monkey-patch — clean (${ROOTS.join(", ")})`);
  process.exit(0);
}

console.error(`lint:no-monkey-patch — ${violations.length} violation(s):\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.match.trim()}`);
}
console.error(
  "\nReplace these with IOutputSink (CLI output) or explicit override arguments on the helper (path/env resolution).",
);
process.exit(1);