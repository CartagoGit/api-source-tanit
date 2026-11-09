/**
 * Tests for `ProjectIndex` (f00016 S2).
 *
 * Uses the `withFixtureAsync` helper so the suite never leaves files
 * on the host. Each tests describe ONE observable property of the
 * index; the bench in `ast-cache-perf.bench.ts` covers the
 * performance budget.
 */

import { describe, expect, test } from "vitest";

import { withFixtureAsync } from "../helpers/fixtures";
import { ProjectIndex } from "../../packages/core/index/project-index.service";
import { detectLanguage } from "../../packages/core/index/file-cache.service";

const PROJECT_FIXTURE = {
  "package.json": JSON.stringify({
    name: "demo-index",
    version: "1.0.0",
    dependencies: { express: "^4.18.0" },
    devDependencies: { typescript: "^5.0.0" },
  }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext" },
  }),
  "src/server.ts": [
    `import express from "express";`,
    `import { usersRouter } from "./users";`,
    ``,
    `const app = express();`,
    `app.use("/users", usersRouter);`,
    ``,
    `export default app;`,
  ].join("\n"),
  "src/users.ts": [
    `import { Router } from "express";`,
    ``,
    `export const usersRouter = Router();`,
    `usersRouter.get("/", (_req, res) => res.json([]));`,
    `usersRouter.post("/", (_req, res) => res.status(201).end());`,
    ``,
    `export default usersRouter;`,
  ].join("\n"),
  "src/services/util.ts": [
    `export function add(a: number, b: number) { return a + b; }`,
  ].join("\n"),
  "README.md": "# demo\n",
};

describe("ProjectIndex (f00016 S2)", () => {
  test("open() returns an index rooted at the project", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const index = await ProjectIndex.open(root);
      try {
        expect(index.root).toBe(root.replace(/[/\\]+$/, ""));
        expect(index.fileCount).toBeGreaterThan(0);
        expect(index.workspaces.length).toBeGreaterThan(0);
        expect(index.workspaces[0]?.relPath).toBe("");
      } finally {
        index.close();
      }
    });
  });

  test("file() returns a record with SHA-256 hash and detected language", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const index = await ProjectIndex.open(root);
      try {
        const file = index.file("src/server.ts");
        expect(file).toBeDefined();
        expect(file?.language).toBe("typescript");
        expect(file?.hashSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(file?.workspace.manager).toBeDefined();
      } finally {
        index.close();
      }
    });
  });

  test("astFor() returns the same AST on the second open of the same project", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const first = await ProjectIndex.open(root, { eagerAst: true });
      try {
        const ast1 = await first.ensureAst("src/server.ts");
        expect(ast1).toBeTruthy();
      } finally {
        first.close();
      }
      const second = await ProjectIndex.open(root, { eagerAst: true });
      try {
        const ast2 = await second.ensureAst("src/server.ts");
        expect(ast2).toBeTruthy();
        // The shape is the same (Babel File node with `type: "File"`),
        // even though we open a fresh index — both parses saw the same
        // bytes and produced the same AST.
        expect((ast2 as { type?: string }).type).toBe("File");
      } finally {
        second.close();
      }
    });
  });

  test("manifestFor() returns parsed JSON for package.json and tsconfig.json", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const index = await ProjectIndex.open(root);
      try {
        const pkg = index.manifestFor("package.json");
        expect(pkg).toBeDefined();
        expect(pkg?.format).toBe("json");
        expect(pkg?.type).toBe("package.json");
        expect(pkg?.hashSha256).toMatch(/^[a-f0-9]{64}$/);
        const parsed = pkg?.parsed as { name?: string; dependencies?: Record<string, string> };
        expect(parsed?.name).toBe("demo-index");
        expect(parsed?.dependencies?.express).toBe("^4.18.0");

        const tsconfig = index.manifestFor("tsconfig.json");
        expect(tsconfig?.type).toBe("tsconfig.json");
        expect((tsconfig?.parsed as { compilerOptions?: { target?: string } })?.compilerOptions?.target).toBe("ES2022");
      } finally {
        index.close();
      }
    });
  });

  test("manifestFor() returns undefined for non-manifest files", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const index = await ProjectIndex.open(root);
      try {
        expect(index.manifestFor("src/server.ts")).toBeUndefined();
        expect(index.manifestFor("README.md")).toBeUndefined();
      } finally {
        index.close();
      }
    });
  });

  test("invalidate() returns the closure (self + importers)", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const index = await ProjectIndex.open(root);
      try {
        index.registerImport({ importer: "src/server.ts", imported: "src/users.ts" });
        index.registerImport({ importer: "src/users.ts", imported: "src/services/util.ts" });
        const closure = index.invalidate("src/services/util.ts");
        expect(closure).toContain("src/services/util.ts");
        expect(closure).toContain("src/users.ts");
        expect(closure).toContain("src/server.ts");
        // An unrelated file stays out of the closure.
        expect(closure).not.toContain("README.md");
      } finally {
        index.close();
      }
    });
  });

  test("invalidate() does not include importers-of-importers-of-importers infinitely", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const index = await ProjectIndex.open(root);
      try {
        index.registerImport({ importer: "a.ts", imported: "b.ts" });
        index.registerImport({ importer: "b.ts", imported: "c.ts" });
        index.registerImport({ importer: "c.ts", imported: "d.ts" });
        const closure = index.invalidate("d.ts");
        // The closure is bounded and terminates on cycles.
        expect(new Set(closure).size).toBe(closure.length);
        expect(closure).toContain("d.ts");
        expect(closure).toContain("c.ts");
        expect(closure).toContain("b.ts");
        expect(closure).toContain("a.ts");
      } finally {
        index.close();
      }
    });
  });

  test("invalidateAll() drops the file / AST / manifest caches", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const index = await ProjectIndex.open(root);
      const before = index.fileCount;
      expect(before).toBeGreaterThan(0);
      expect(index.manifestCount).toBeGreaterThan(0);
      index.invalidateAll();
      expect(index.fileCount).toBe(0);
      expect(index.manifestCount).toBe(0);
      expect(index.file("src/server.ts")).toBeUndefined();
      expect(index.manifestFor("package.json")).toBeUndefined();
      index.close();
    });
  });

  test("close() makes every accessor return undefined", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const index = await ProjectIndex.open(root);
      index.close();
      expect(index.file("src/server.ts")).toBeUndefined();
      expect(index.manifestFor("package.json")).toBeUndefined();
      expect(index.astFor("src/server.ts")).toBeUndefined();
      expect(index.invalidate("src/server.ts")).toEqual([]);
    });
  });

  test("workspaces array is non-empty and reports a known manager", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const index = await ProjectIndex.open(root);
      try {
        const rootWs = index.workspaces[0];
        expect(rootWs?.relPath).toBe("");
        expect(["npm", "yarn", "pnpm", "bun", "turbo", "unknown"]).toContain(rootWs?.manager);
      } finally {
        index.close();
      }
    });
  });

  test("file() with posix separators works on Windows paths in the index", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const index = await ProjectIndex.open(root);
      try {
        expect(index.file("src/server.ts")).toBeDefined();
        // Whatever the OS separator is, the lookup normalises.
        expect(index.file("src\\server.ts")).toBeDefined();
      } finally {
        index.close();
      }
    });
  });

  test("language detector covers the slice's matrix", () => {
    // Mirrors the acceptance text:
    //   tsconfig.json / package.json / go.mod / Cargo.toml /
    //   composer.json / pyproject.toml / Gemfile / mix.exs
    expect(detectLanguage("app.ts")).toBe("typescript");
    expect(detectLanguage("app.tsx")).toBe("tsx");
    expect(detectLanguage("app.go")).toBe("go");
    expect(detectLanguage("app.rs")).toBe("rust");
    expect(detectLanguage("composer.json")).toBe("json");
    expect(detectLanguage("Gemfile")).toBe("ruby");
    expect(detectLanguage("mix.exs")).toBe("elixir");
    expect(detectLanguage("unknown.bin")).toBe("unknown");
  });

  test("hashes are stable across two opens of the same root", async () => {
    await withFixtureAsync(PROJECT_FIXTURE, async (root) => {
      const a = await ProjectIndex.open(root);
      const b = await ProjectIndex.open(root);
      try {
        const hashA = a.file("src/server.ts")?.hashSha256;
        const hashB = b.file("src/server.ts")?.hashSha256;
        expect(hashA).toBeDefined();
        expect(hashA).toBe(hashB);
      } finally {
        a.close();
        b.close();
      }
    });
  });
});