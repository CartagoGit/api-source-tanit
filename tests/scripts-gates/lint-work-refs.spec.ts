import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  WORKTREE_ROOT,
  forgeRefOf,
  huskWorktrees,
  integratedRefs,
  isWorkRef,
  refName,
  type IWorkRef,
} from "../../scripts/gates/lint-work-refs.script.js";

/** Un clon de mentira con un commit, para probar la ascendencia de verdad. */
async function repoWithACommit(): Promise<{ root: string; base: string }> {
  const root = await mkdtemp(join(tmpdir(), "tanit-work-refs-"));
  const git = (...args: readonly string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--initial-branch=develop");
  git("config", "user.email", "gate@example.invalid");
  git("config", "user.name", "gate");
  execFileSync("git", ["commit", "--allow-empty", "-m", "base"], {
    cwd: root,
    encoding: "utf8",
  });
  return { root, base: git("rev-parse", "HEAD") };
}

describe("las refs de trabajo y de publicación", () => {
  test("una ref de trabajo o de publicación se reconoce por su prefijo", () => {
    expect(isWorkRef("refs/heads/wip/minimax-m3.1-flash/create/x00082-all-g1/tema")).toBe(true);
    expect(isWorkRef("refs/heads/pr/minimax-m3.1-flash/create/x00082-all-g1/tema")).toBe(true);
    expect(isWorkRef("refs/remotes/origin/wip/minimax-m3.1-flash/create/x00082-all-g1/tema")).toBe(true);
  });

  test("una rama que no es de trabajo no se confunde con una", () => {
    expect(isWorkRef("refs/heads/develop")).toBe(false);
    expect(isWorkRef("refs/heads/main")).toBe(false);
    expect(isWorkRef("refs/remotes/origin/develop")).toBe(false);
    expect(isWorkRef("refs/retired/minimax-m3.1-flash/review/batch-all-g1/verdicts")).toBe(false);
  });

  test("la ref del forge es la que se puede borrar", () => {
    expect(forgeRefOf("refs/remotes/origin/wip/x/y")).toBe("refs/heads/wip/x/y");
    expect(forgeRefOf("refs/remotes/origin/pr/x/y")).toBe("refs/heads/pr/x/y");
    expect(forgeRefOf("refs/heads/wip/x/y")).toBe("refs/heads/wip/x/y");
  });

  test("la misma rama vista desde dos sitios tiene el mismo nombre", () => {
    expect(refName("refs/heads/wip/x/y")).toBe("wip/x/y");
    expect(refName("refs/remotes/origin/wip/x/y")).toBe("wip/x/y");
  });
});

describe("qué refs están ya integradas", () => {
  test("la ref cuyo commit está en la historia se marca, y la otra no", () => {
    const refs: IWorkRef[] = [
      { ref: "refs/heads/pr/a", sha: "integrada" },
      { ref: "refs/heads/pr/b", sha: "viva" },
    ];
    expect(integratedRefs(refs, (sha) => sha === "integrada")).toEqual([
      "refs/heads/pr/a",
    ]);
  });

  test("una ref de trabajo con alguien trabajando en ella no es un resto", () => {
    const refs: IWorkRef[] = [
      { ref: "refs/heads/wip/alguien/x", sha: "integrada" },
    ];
    expect(integratedRefs(refs, () => true, ["wip/alguien/x"])).toEqual([]);
  });

  test("una ref de trabajo abandonada e integrada sí es un resto", () => {
    const refs: IWorkRef[] = [
      { ref: "refs/heads/wip/alguien/x", sha: "integrada" },
    ];
    expect(integratedRefs(refs, () => true, [])).toEqual([
      "refs/heads/wip/alguien/x",
    ]);
  });

  test("una publicación del forge se marca por su nombre de ref", () => {
    const refs: IWorkRef[] = [
      { ref: "refs/remotes/origin/pr/x/y", sha: "integrada" },
    ];
    expect(integratedRefs(refs, () => true)).toEqual([
      "refs/remotes/origin/pr/x/y",
    ]);
  });
});

describe("los worktrees que se quedan sin ref", () => {
  test("el worktree sin ref de trabajo es un resto, y el que la tiene no", () => {
    const husks = huskWorktrees(
      [
        { path: join(WORKTREE_ROOT, "unidad"), branch: "wip/alguien/x" },
        { path: join(WORKTREE_ROOT, "restos"), branch: "wip/alguien/y" },
        { path: "/otro/clon", branch: "wip/alguien/z" },
      ],
      ["wip/alguien/x"],
    );
    expect(husks).toEqual([join(WORKTREE_ROOT, "restos")]);
  });

  test("el checkout principal no cuenta como resto", () => {
    expect(huskWorktrees([{ path: "/repo", branch: "develop" }], [])).toEqual(
      [],
    );
  });
});

describe("la ascendencia, con git de verdad", () => {
  test("un commit fusionado es ancestro de la rama, y el otro no", async () => {
    const { root, base } = await repoWithACommit();
    try {
      const git = (...args: readonly string[]): boolean => {
        try {
          execFileSync("git", args, { cwd: root, encoding: "utf8" });
          return true;
        } catch {
          return false;
        }
      };
      const sha = (ref: string): string =>
        execFileSync("git", ["rev-parse", ref], {
          cwd: root,
          encoding: "utf8",
        }).trim();

      // Una rama con trabajo que se integra.
      git("checkout", "-b", "wip/alguien/integrada");
      execFileSync("git", ["commit", "--allow-empty", "-m", "trabajo"], {
        cwd: root,
        encoding: "utf8",
      });
      const integrated = sha("HEAD");
      git("checkout", "develop");
      git("merge", "--no-ff", "-m", "merge", "wip/alguien/integrada");

      // Otra rama con trabajo que sigue sin integrarse.
      git("checkout", "-b", "wip/alguien/viva");
      execFileSync("git", ["commit", "--allow-empty", "-m", "a medias"], {
        cwd: root,
        encoding: "utf8",
      });
      const viva = sha("HEAD");
      git("checkout", "develop");

      const isAncestor = (candidate: string): boolean =>
        git("merge-base", "--is-ancestor", candidate, "develop");
      const refs: IWorkRef[] = [
        { ref: "refs/heads/pr/alguien/integrada", sha: integrated },
        { ref: "refs/heads/wip/alguien/viva", sha: viva },
      ];
      expect(integratedRefs(refs, isAncestor)).toEqual([
        "refs/heads/pr/alguien/integrada",
      ]);
      expect(base).not.toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
