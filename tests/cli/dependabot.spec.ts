/**
 * What Dependabot watches, what it does not, and why the fake
 * manifests carry up-to-date versions.
 *
 * Dependabot has two halves that are configured differently:
 *
 *   · **Updates** come from `.github/dependabot.yml`, which names
 *     directories one by one.
 *   · **Alerts** come from the *dependency graph*, which scans all
 *     the manifests in the repository and admits no per-path
 *     exclusions.
 *
 * Confusing them cost a whole round: only the two real packages
 * were declared in the `.yml`, assuming the 67 open alerts would
 * close themselves, and not a single one moved. What stopped
 * arriving were the update PRs.
 *
 * And they needed to close, because the 67 came from the **50
 * manifests this repo contains and does not own**: every project in
 * `examples/` and every fixture in `tests/` brings its own, because
 * that is where the scanners infer the framework from. The thirteen
 * flagged paths were all under `examples/` or `tests/`, not one under
 * a real package, while `bun audit` stayed at zero. That is not
 * security: it is noise that **hides** the real warnings.
 *
 * Because the graph cannot be filtered, the lever left is what the
 * fake manifests declare, hence the policy this spec watches: **a
 * sample manifest declares the version a real project would declare
 * today**. It costs nothing —that code never runs— and in exchange
 * the graph has nothing to flag.
 */
import { describe, expect, test } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper";

const DEPENDABOT_YML = join(REPO_ROOT, ".github", "dependabot.yml");

/**
 * Version floor per package: the first version without open alerts.
 *
 * Each entry is a package that **did alert for real**, and the number
 * is the `first_patched_version` the alert itself returned. It is not
 * a wishlist: it is the record of what already happened, so that it
 * does not happen again.
 */
const VERSION_FLOOR: Readonly<Record<string, string>> = {
  "@apollo/server": "5.5.0",
  "@nestjs/common": "11.1.18",
  "@nestjs/core": "11.1.18",
  "@nestjs/platform-express": "11.1.18",
  fastify: "5.7.2",
  "github.com/gin-gonic/gin": "1.9.1",
  "github.com/gofiber/fiber/v2": "2.52.14",
  "laravel/framework": "12.60.0",
  next: "15.5.21",
};

/** Folders whose manifests are fake. */
const FAKE_ROOTS = ["examples", "tests"] as const;

/** `^15.5.21`, `>=1.2`, `6.4.*`, `v2.52.14` → `[15, 5, 21]`. */
function toParts(raw: string): number[] {
  const cleaned = raw.trim().replace(/^[\^~>=<v\s]+/, "");
  return cleaned.split(/[.\-+]/).map((chunk) => Number.parseInt(chunk, 10) || 0);
}

/** Is `declared` greater than or equal to `floor`? */
function meetsFloor(declared: string, floor: string): boolean {
  const left = toParts(declared);
  const right = toParts(floor);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

interface IDeclaration {
  readonly file: string;
  readonly name: string;
  readonly version: string;
}

/** The name/version pairs of a manifest, whatever the ecosystem. */
function parseManifest(file: string, raw: string): IDeclaration[] {
  const found: IDeclaration[] = [];

  if (file.endsWith("go.mod")) {
    // `require x v1.2.3`, either bare or inside a block.
    for (const m of raw.matchAll(/^\s*(?:require\s+)?([\w.\-/]+\.[\w.\-/]+)\s+(v[\d.]+)/gm)) {
      found.push({ file, name: m[1] ?? "", version: m[2] ?? "" });
    }
    return found;
  }

  // `package.json` and `composer.json` share the same shape: an
  // object of name → range, under one key or another.
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return found;
  }
  for (const key of ["dependencies", "devDependencies", "require", "require-dev"]) {
    const block = doc[key];
    if (typeof block !== "object" || block === null) continue;
    for (const [name, version] of Object.entries(block as Record<string, unknown>)) {
      if (typeof version === "string") found.push({ file, name, version });
    }
  }
  return found;
}

const MANIFEST_NAMES = new Set(["package.json", "composer.json", "go.mod"]);

/** Everything the fake manifests declare. */
async function fakeDeclarations(): Promise<IDeclaration[]> {
  const out: IDeclaration[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "vendor") continue;
        await walk(full);
      } else if (MANIFEST_NAMES.has(entry.name)) {
        const raw = await readFile(full, "utf8");
        out.push(...parseManifest(relative(REPO_ROOT, full), raw));
      }
    }
  };
  for (const root of FAKE_ROOTS) await walk(join(REPO_ROOT, root));
  return out;
}

/** The `directory:` entries declared in the configuration. */
async function declaredDirectories(): Promise<string[]> {
  const raw = await readFile(DEPENDABOT_YML, "utf8");
  return [...raw.matchAll(/^\s*directory:\s*"([^"]+)"/gm)].map((m) => m[1] ?? "");
}

/** The packages this repo actually installs. */
async function realPackages(): Promise<string[]> {
  const pkg = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")) as {
    workspaces?: string[];
  };
  // The root plus each workspace member. A workspace is, by
  // definition, a package that `bun install` resolves.
  return ["/", ...(pkg.workspaces ?? []).map((w) => `/${w}`)];
}

describe("which directories get updated", () => {
  test("the configuration exists", async () => {
    await expect(readFile(DEPENDABOT_YML, "utf8")).resolves.toContain("version: 2");
  });

  // A real package without watching is a dependency that ages alone.
  test("covers every package that is actually installed", async () => {
    const declared = await declaredDirectories();
    for (const dir of await realPackages()) {
      expect(declared, `missing ${dir}`).toContain(dir);
    }
  });

  /**
   * The symmetric failure: if someone adds `examples/` to the list
   * to "cover it all", the dozens of update PRs come back over
   * dependencies that nobody installs.
   */
  test("does not request updates for the fake manifests", async () => {
    for (const dir of await declaredDirectories()) {
      expect(dir, `${dir} is not a package of this repo`).not.toMatch(/^\/(examples|tests)\b/);
    }
  });

  test("workflow actions are also watched", async () => {
    // An old action is third-party code running with the repo's
    // token.
    await expect(readFile(DEPENDABOT_YML, "utf8")).resolves.toContain("github-actions");
  });
});

describe("what versions the fake manifests declare", () => {
  /**
   * THE test. Without it, copying an old example to make a new one
   * reintroduces the alerts without anyone noticing until GitHub
   * rebuilds the graph, which is days later and on another branch.
   */
  test("none declares a version with open alerts", async () => {
    const culpables = (await fakeDeclarations())
      .filter((d) => VERSION_FLOOR[d.name] !== undefined)
      .filter((d) => !meetsFloor(d.version, VERSION_FLOOR[d.name] ?? "0"))
      .map((d) => `${d.file}: ${d.name}@${d.version} < ${VERSION_FLOOR[d.name]}`);

    expect(culpables, culpables.join("\n")).toEqual([]);
  });

  /**
   * The floor only serves if someone meets it. If a package in the
   * table no longer appears in any manifest, the entry is
   * redundant and must be removed — otherwise the table becomes
   * folklore.
   */
  test("each floor corresponds to a package that is actually declared", async () => {
    const declarados = new Set((await fakeDeclarations()).map((d) => d.name));
    for (const name of Object.keys(VERSION_FLOOR)) {
      expect(declarados, `${name} is no longer declared: its floor is redundant`).toContain(name);
    }
  });

  // Check the comparator, which is where these failures hide.
  test("the comparator understands the ranges present in the manifests", () => {
    expect(meetsFloor("^15.5.21", "15.5.21")).toBe(true);
    expect(meetsFloor("^14.0.0", "15.5.21")).toBe(false);
    expect(meetsFloor("v2.52.14", "2.52.14")).toBe(true);
    expect(meetsFloor("v2.52.0", "2.52.14")).toBe(false);
    expect(meetsFloor("^12.61.1", "12.60.0")).toBe(true);
    expect(meetsFloor("^11.0", "12.60.0")).toBe(false);
    // 5.10 > 5.9: numeric comparison, not string.
    expect(meetsFloor("^5.10.0", "5.9.0")).toBe(true);
  });
});

describe("the configuration explains itself", () => {
  test("distinguishes updates from alerts, which is what got confused", async () => {
    const raw = await readFile(DEPENDABOT_YML, "utf8");
    expect(raw).toContain("grafo de dependencias");
    expect(raw).toContain("examples/");
    expect(raw.split("\n").filter((l) => l.startsWith("#")).length).toBeGreaterThan(10);
  });
});
