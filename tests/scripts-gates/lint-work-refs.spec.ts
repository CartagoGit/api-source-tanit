import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DOCTOR_CHECKS,
  HUSK_QUIET_MS,
  abandonedWorkRefs,
  failedVerdicts,
  forgeRefOf,
  huskDirectories,
  isWorkRef,
  leftoverWorktrees,
  parseDoctorReport,
  publicationsOf,
  refName,
  spentPublications,
  type IUnitDirectory,
  type IVerdict,
  type IWorkRef,
  type IWorktree,
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

describe("las publicaciones", () => {
  test("la misma publicación vista desde dos sitios es una sola", () => {
    const refs: IWorkRef[] = [
      { ref: "refs/heads/pr/equipo/tema", sha: "vieja" },
      { ref: "refs/remotes/origin/pr/equipo/tema", sha: "del-forge" },
    ];
    expect(publicationsOf(refs)).toEqual([
      { ref: "refs/remotes/origin/pr/equipo/tema", sha: "del-forge" },
    ]);
  });

  test("una ref de trabajo no es una publicación", () => {
    const refs: IWorkRef[] = [{ ref: "refs/heads/wip/equipo/tema", sha: "x" }];
    expect(publicationsOf(refs)).toEqual([]);
  });

  test("la publicación cuyo commit está en la historia está gastada, la otra no", () => {
    const refs: IWorkRef[] = [
      { ref: "refs/heads/pr/gastada", sha: "integrada" },
      { ref: "refs/heads/pr/viva", sha: "sin-integrar" },
    ];
    expect(spentPublications(refs, (sha) => sha === "integrada")).toEqual([
      "pr/gastada",
    ]);
  });

  test("una ref de trabajo no se gasta por estar en la historia", () => {
    const refs: IWorkRef[] = [{ ref: "refs/heads/wip/equipo/tema", sha: "x" }];
    expect(spentPublications(refs, () => true)).toEqual([]);
  });
});

describe("las refs de trabajo abandonadas", () => {
  test("una ref sin worktree encima está abandonada", () => {
    const refs: IWorkRef[] = [
      { ref: "refs/heads/wip/equipo/tema", sha: "x" },
      { ref: "refs/heads/wip/otro/tema", sha: "y" },
    ];
    expect(abandonedWorkRefs(refs, ["wip/otro/tema"])).toEqual([
      "wip/equipo/tema",
    ]);
  });

  test("una ref del forge no es una ref local abandonada", () => {
    const refs: IWorkRef[] = [
      { ref: "refs/remotes/origin/wip/equipo/tema", sha: "x" },
    ];
    expect(abandonedWorkRefs(refs, [])).toEqual([]);
  });
});

describe("los worktrees y los directorios que sobran", () => {
  test("un worktree que no está en una ref de trabajo sobra", () => {
    const worktrees: IWorktree[] = [
      { path: "/repo", branch: "develop" },
      { path: "/repo/.cache/delendai/.worktrees/unidad", branch: "wip/equipo/tema" },
      { path: "/repo/.cache/delendai/.worktrees/resto", branch: "" },
    ];
    expect(leftoverWorktrees(worktrees, "/repo")).toEqual([
      "/repo/.cache/delendai/.worktrees/resto",
    ]);
  });

  test("un directorio sin worktree es un resto", () => {
    const worktrees: IWorktree[] = [
      { path: "/repo", branch: "develop" },
      { path: "/units/unidad", branch: "wip/equipo/tema" },
    ];
    const units: IUnitDirectory[] = [
      { name: "unidad", path: "/units/unidad", touchedAt: 0 },
      { name: "resto", path: "/units/resto", touchedAt: 0 },
    ];
    expect(huskDirectories(worktrees, units, HUSK_QUIET_MS + 1)).toEqual([
      "resto",
    ]);
  });

  test("un directorio recién tocado no es un resto todavía", () => {
    const worktrees: IWorktree[] = [{ path: "/repo", branch: "develop" }];
    const units: IUnitDirectory[] = [
      { name: "resto", path: "/units/resto", touchedAt: 1_000 },
    ];
    expect(huskDirectories(worktrees, units, 1_000 + 1)).toEqual([]);
  });
});

describe("el informe del doctor", () => {
  test("se leen sus veredictos", () => {
    const verdicts = parseDoctorReport(
      JSON.stringify({
        broken: 1,
        results: [
          {
            id: "publications-hold-work",
            holds: false,
            observed: "1 spent: pr/equipo/tema",
            remedy: "retire it",
          },
          { id: "checkout-clean", holds: true, observed: "clean" },
        ],
      }),
    );
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]?.id).toBe("publications-hold-work");
    expect(verdicts[0]?.holds).toBe(false);
  });

  test("un informe que no es del doctor no da veredictos", () => {
    expect(parseDoctorReport("{}")).toEqual([]);
    expect(parseDoctorReport("[]")).toEqual([]);
  });

  test("el gate mira cuatro veredictos, y sólo los que fallan", () => {
    expect(DOCTOR_CHECKS).toHaveLength(4);
    const verdicts: IVerdict[] = [
      { id: "publications-hold-work", holds: false, observed: "", remedy: "" },
      { id: "no-abandoned-work-refs", holds: true, observed: "", remedy: "" },
      { id: "checkout-clean", holds: false, observed: "", remedy: "" },
      { id: "no-husk-directories", holds: false, observed: "", remedy: "" },
    ];
    expect(failedVerdicts(verdicts).map((each) => each.id)).toEqual([
      "publications-hold-work",
      "no-husk-directories",
    ]);
  });
});

describe("la ascendencia, de verdad", () => {
  test("una rama integrada está gastada y una que no, no", async () => {
    const { root, base } = await repoWithACommit();
    try {
      const git = (...args: readonly string[]): string =>
        execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
      git("checkout", "-b", "pr/equipo/tema");
      execFileSync("git", ["commit", "--allow-empty", "-m", "trabajo"], {
        cwd: root,
        encoding: "utf8",
      });
      const tip = git("rev-parse", "HEAD");
      git("checkout", "develop");
      git("merge", "--no-ff", "-m", "merge", "pr/equipo/tema");
      git("checkout", "-b", "pr/equipo/otra");
      execFileSync("git", ["commit", "--allow-empty", "-m", "otro"], {
        cwd: root,
        encoding: "utf8",
      });
      const otra = git("rev-parse", "HEAD");

      const isAncestor = (sha: string): boolean => {
        try {
          execFileSync("git", ["merge-base", "--is-ancestor", sha, "develop"], {
            cwd: root,
            encoding: "utf8",
          });
          return true;
        } catch {
          return false;
        }
      };

      expect(isAncestor(base)).toBe(true);
      expect(isAncestor(tip)).toBe(true);
      expect(isAncestor(otra)).toBe(false);
      expect(
        spentPublications(
          [
            { ref: "refs/heads/pr/equipo/tema", sha: tip },
            { ref: "refs/heads/pr/equipo/otra", sha: otra },
          ],
          isAncestor,
        ),
      ).toEqual(["pr/equipo/tema"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
