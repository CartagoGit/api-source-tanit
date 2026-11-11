import { mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  absPathOf,
  filesByLanguage,
  indexFiles,
  joinPosix,
  keyOf,
  readIndexedFile,
  refreshIndexedFile,
  sha256Of,
  snapshotFiles,
  toPosix,
} from "../../packages/core/index/file-cache.service.js";
import {
  declaredDependenciesFromManifest,
  isManifestFile,
  readManifest,
  readManifests,
} from "../../packages/core/index/manifest-reader.service.js";
import {
  detectWorkspaces,
  workspaceFor,
} from "../../packages/core/index/workspace-resolver.service.js";
import { IncrementalInvalidator } from "../../packages/core/index/incremental-invalidator.service.js";
import { ProjectIndex } from "../../packages/core/index/project-index.service.js";
import type { IIndexedFile, IWorkspace } from "../../packages/contracts/interfaces/core/index.interface.js";
import type { ISymbolGraph } from "../../packages/contracts/interfaces/core/symbol-graph.interface.js";

async function withTempProject(
  files: Record<string, string>,
  callback: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "core-index-coverage-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(root, relativePath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const rootWorkspace: IWorkspace = {
  relPath: "",
  absPath: "/project",
  manager: "unknown",
};

describe("index file cache utilities", () => {
  test("normalizes paths, hashes text, snapshots files, and groups languages", () => {
    const files = new Map<string, IIndexedFile>([
      ["src/a.ts", { relPath: "src/a.ts", absPath: "/project/src/a.ts", size: 1, hashSha256: "a", language: "typescript", workspace: rootWorkspace }],
      ["README", { relPath: "README", absPath: "/project/README", size: 1, hashSha256: "b", language: "unknown", workspace: rootWorkspace }],
      ["data.json", { relPath: "data.json", absPath: "/project/data.json", size: 1, hashSha256: "c", language: "json", workspace: rootWorkspace }],
    ]);
    expect(toPosix("src\\a.ts")).toBe("src/a.ts");
    expect(joinPosix("/src/", "/a.ts/")).toBe("src/a.ts");
    expect(absPathOf("/project", "src/a.ts")).toBe("/project/src/a.ts");
    expect(keyOf("/src\\a.ts")).toBe("src/a.ts");
    expect(sha256Of("hello")).toHaveLength(64);
    expect(snapshotFiles(files)).toHaveLength(3);
    expect(filesByLanguage(files)).toEqual(new Map([
      ["typescript", 1],
      ["unknown", 1],
      ["json", 1],
    ]));
  });

  test("reads files, skips directories, refreshes and removes disappeared files", async () => {
    await withTempProject({ "src/a.ts": "export const a = 1;", "src/dir": "not a dir" }, async (root) => {
      const absPath = join(root, "src/a.ts");
      const files = new Map<string, IIndexedFile>();
      const indexed = await readIndexedFile(absPath, root, [rootWorkspace]);
      expect(indexed?.language).toBe("typescript");
      expect(await readIndexedFile(join(root, "missing.ts"), root, [rootWorkspace])).toBeNull();
      expect(await readIndexedFile(root, root, [rootWorkspace])).toBeNull();
      const refreshed = await refreshIndexedFile(files, absPath, root, [rootWorkspace]);
      expect(refreshed?.hashSha256).toBe(indexed?.hashSha256);
      await rm(absPath);
      expect(await refreshIndexedFile(files, absPath, root, [rootWorkspace])).toBeNull();
      expect(files.size).toBe(0);
    });
  });

  test("indexes files with and without vendor-directory skipping", async () => {
    await withTempProject({
      "src/a.ts": "export const a = 1;",
      "node_modules/pkg/index.js": "module.exports = 1;",
      "dist/generated.js": "ignored();",
    }, async (root) => {
      const skipped = await indexFiles({ projectRoot: root, workspaces: [rootWorkspace] });
      expect(skipped.has("src/a.ts")).toBe(true);
      expect(skipped.has("node_modules/pkg/index.js")).toBe(false);
      const included = await indexFiles({ projectRoot: root, workspaces: [rootWorkspace], skipVendorDirs: false });
      expect(included.has("node_modules/pkg/index.js")).toBe(true);
    });
  });
});

describe("manifest reader", () => {
  test("recognizes manifest basenames and parses JSON/TOML/text formats", async () => {
    await withTempProject({
      "package.json": JSON.stringify({ dependencies: { a: "1", shared: "prod" }, devDependencies: { b: "2", shared: "dev" }, peerDependencies: { c: "3" } }),
      "Cargo.toml": "[workspace]\nmembers = [\"crate-a\"]\n",
      "go.mod": "module example.com/demo\n",
      "README.md": "readme",
    }, async (root) => {
      expect(isManifestFile("nested/package.json")).toBe(true);
      expect(isManifestFile("README.md")).toBe(false);
      expect(await readManifest({ projectRoot: root, relPath: "README.md" })).toBeNull();
      expect(await readManifest({ projectRoot: root, relPath: "missing/package.json" })).toBeNull();
      const packageManifest = await readManifest({ projectRoot: root, relPath: "package.json" });
      expect(packageManifest?.parsed).toEqual(expect.objectContaining({ dependencies: expect.any(Object) }));
      expect(declaredDependenciesFromManifest(packageManifest!)).toEqual({ a: "1", shared: "prod", b: "2", c: "3" });
      const cargo = await readManifest({ projectRoot: root, relPath: "Cargo.toml" });
      expect(cargo?.parsed).toEqual({ workspace: { members: ["crate-a"] } });
      const go = await readManifest({ projectRoot: root, relPath: "go.mod" });
      expect(go?.parsed).toBeUndefined();
      expect(declaredDependenciesFromManifest(cargo!)).toEqual({});
      expect(await readManifests({ projectRoot: root, relPaths: ["package.json", "README.md", "go.mod"] })).toHaveProperty("size", 2);
    });
  });

  test("returns empty dependencies for malformed/non-JSON manifest data", async () => {
    await withTempProject({ "package.json": "{broken" }, async (root) => {
      const manifest = await readManifest({ projectRoot: root, relPath: "package.json" });
      expect(manifest?.parsed).toBeUndefined();
      expect(declaredDependenciesFromManifest(manifest!)).toEqual({});
    });
  });
});

describe("workspace resolver", () => {
  test("resolves package, pnpm, cargo, go, composer, and poetry workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "core-workspaces-"));
    const files: Record<string, string> = {
      [join(root, "package.json")]: JSON.stringify({ workspaces: ["packages/*", { ".": "apps/api" }] }),
      [join(root, "pnpm-workspace.yaml")]: "packages:\n- 'packages/*'\n- apps/*\n",
      [join(root, "Cargo.toml")]: "[workspace]\nmembers = [\"crates/api\", \"crates/lib\"]\n\n[package]\nname=\"root\"\n",
      [join(root, "go.work")]: "go 1.22\nuse ./services/api\nuse ./services/web\n",
      [join(root, "composer.json")]: JSON.stringify({ extra: { "installer-paths": { "vendor": "packages/php" } } }),
      [join(root, "pyproject.toml")]: "[tool.poetry]\npackages = [{ include = \"demo\" }, \"shared\"]\n",
    };
    try {
      for (const [path, content] of Object.entries(files)) await writeFile(path, content, "utf8");
      const result = detectWorkspaces({ projectRoot: root, readTextFile: (path) => {
        try { return readFileSync(path, "utf8"); } catch { return null; }
      } });
      expect(result.map((workspace) => workspace.relPath)).toEqual(expect.arrayContaining(["packages/*", "apps/api", "apps/*", "crates/api", "services/api", "packages/php", "demo", "shared"]));
      expect(result[0]?.manager).toBe("npm");
      expect(result.find((workspace) => workspace.relPath === "apps/api")?.markerRelPath).toBe("apps/api/package.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects traversal and finds the most specific workspace", () => {
    const result = detectWorkspaces({
      projectRoot: "/project",
      readTextFile: (path) => path.endsWith("package.json") ? JSON.stringify({ workspaces: ["packages/api", "../outside"] }) : null,
    });
    expect(result.map((workspace) => workspace.relPath)).not.toContain("../outside");
    const nested = result.find((workspace) => workspace.relPath === "packages/api")!;
    expect(workspaceFor([rootWorkspace, nested], "/project", "/project/packages/api/src/index.ts")).toBe(nested);
    expect(workspaceFor([rootWorkspace], "/project", "/other/file.ts")).toBeUndefined();
  });
});

describe("incremental invalidator", () => {
  test("registers idempotent edges, computes closures, and forgets them", () => {
    const invalidator = new IncrementalInvalidator();
    invalidator.registerImport("a.ts", "b.ts");
    invalidator.registerImports([{ importer: "a.ts", imported: "b.ts" }, { importer: "b.ts", imported: "c.ts" }, { importer: "", imported: "x.ts" }, { importer: "a.ts", imported: "a.ts" }]);
    expect(invalidator.importsOf("a.ts")).toEqual(["b.ts"]);
    expect(invalidator.importersOf("b.ts")).toEqual(["a.ts"]);
    expect(invalidator.closureFor("c.ts")).toEqual(["c.ts", "b.ts", "a.ts"]);
    expect(invalidator.frontierFor("b.ts")).toEqual(["a.ts"]);
    expect(invalidator.stats()).toEqual({ nodes: 4, edges: 2 });
    invalidator.forget("b.ts");
    expect(invalidator.closureFor("c.ts")).toEqual(["c.ts"]);
    invalidator.clear();
    expect(invalidator.stats()).toEqual({ nodes: 0, edges: 0 });
  });

  test("seeds only resolved symbol-graph imports and terminates cycles", () => {
    const invalidator = new IncrementalInvalidator();
    const graph: ISymbolGraph = {
      nodes: [],
      imports: [
        { sourceFile: "/project/a.ts", specifier: "./b", localName: "b", importedName: "b", targetFile: "/project/b.ts" },
        { sourceFile: "b.ts", specifier: "./a", localName: "a", importedName: "a", targetFile: "a.ts" },
        { sourceFile: "external.ts", specifier: "x", localName: "x", importedName: "x", targetFile: null },
      ],
      resolveByName: () => [],
      resolveByImportPath: () => [],
    };
    invalidator.populateFromSymbolGraph(graph);
    expect(invalidator.closureFor("a.ts")).toEqual(["a.ts", "b.ts"]);
    expect(invalidator.importersOf("external.ts")).toEqual([]);
  });
});

describe("ProjectIndex additional branches", () => {
  test("exposes files/imports/diagnostics and symbol graph imports", async () => {
    await withTempProject({ "package.json": "{}", "src/a.ts": "export const a = 1;" }, async (root) => {
      const graph: ISymbolGraph = {
        nodes: [],
        imports: [{ sourceFile: "src/a.ts", specifier: "x", localName: "x", importedName: "x", targetFile: "src/b.ts" }],
        resolveByName: () => [],
        resolveByImportPath: () => [],
      };
      const index = await ProjectIndex.open(root, { symbolGraph: graph });
      try {
        expect(index.files()).not.toHaveLength(0);
        expect(index.importsFor("src/a.ts")).toHaveLength(1);
        expect(index.filesByLanguage().get("typescript")).toBe(1);
        expect(index.invalidatorStats().edges).toBe(1);
        expect(index.astFor("missing.ts")).toBeUndefined();
        expect(index.ensureAst("missing.ts")).resolves.toBeUndefined();
      } finally {
        index.close();
      }
    });
  });
});