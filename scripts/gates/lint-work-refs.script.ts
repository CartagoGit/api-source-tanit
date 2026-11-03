#!/usr/bin/env bun
/**
 * `bun run lint:work-refs` -- ninguna rama de trabajo ni de publicación
 * sobrevive a su integración.
 *
 * Por qué existe
 * ──────────────
 * Una unidad de trabajo publica su trabajo en una rama (`pr/...`) y
 * trabaja en otra (`wip/...`). Cuando ese trabajo aterriza en `develop`,
 * las dos refs dejan de tener trabajo que justifique su existencia: la
 * rama de la publicación ya está integrada y la de trabajo ya no
 * sostiene nada. En la práctica se quedan ahí, y el clon se llena de
 * ramas que nadie sabe si son trabajo vivo o trabajo que ya está
 * integrado.
 *
 * El runtime sabe limpiarlo (`delendai work reap`, `delendai work
 * retire`, `delendai work doctor`), pero sólo se le pregunta. Este gate
 * es el que lo pregunta en cada `lint`, y el que dice qué sobra.
 *
 * Qué mira
 * ────────
 * 1. **Publicaciones ya integradas**: una rama `pr/...` cuyo commit es
 *    ancestro de la rama de integración ya no guarda nada: su trabajo
 *    está en `develop`. Se puede borrar.
 * 2. **Refs de trabajo abandonadas**: una rama `wip/...` que además de
 *    estar integrada **no tiene worktree** encima no la sostiene
 *    nadie: su agente ya no trabaja en ella.
 * 3. **Worktrees sin ref**: un directorio de worktree del runtime cuya
 *    rama no es una ref de trabajo es un resto: el trabajo se integró y
 *    el worktree se quedó.
 *
 * Por qué la ref de trabajo necesita las dos pruebas
 * ────────────────────────────────────────────────────
 * Una ref `wip/...` recién creada **apunta al mismo commit** que la
 * rama de integración: hasta que la unidad commitea algo, no hay
 * diferencia entre ella y `develop`. Preguntar sólo "¿es ancestro?"
 * marcaría toda unidad viva como si estuviera integrada, y borrarla
 * sería tirar el trabajo del agente. Por eso una ref de trabajo sólo
 * cuenta como resto si su commit está integrado **y** no hay nadie
 * trabajando en ella.
 *
 * Qué NO mira
 * ──────────
 * - El trabajo **no** integrado: una ref cuyo commit no está en
 *   `develop` es una unidad viva, y borrarla sería tirar trabajo.
 * - Las refs de archivo (`refs/retired/...`): guardan el commit de un
 *   trabajo retirado para que no se pierda, y no son ramas.
 * - Los claims del runtime (`refs/delendai/claims/...`): son suyos, y
 *   los suelta él cuando la propuesta se cierra.
 *
 * Uso:
 *   bun run lint:work-refs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { REPO_ROOT, fromRoot } from "../helpers/root.helper.js";

const execFileAsync = promisify(execFile);

/** Los prefijos de ref que son de trabajo o de publicación. */
export const WORK_REF_PREFIXES = ["wip/", "pr/"] as const;

/**
 * Dónde viven los worktrees del runtime. Un directorio de worktree fuera
 * de aquí no es suyo, y el gate no tiene nada que decir de él.
 */
export const WORKTREE_ROOT = fromRoot(".cache", "delendai", ".worktrees");

/** Una ref de trabajo o de publicación, con el commit al que apunta. */
export interface IWorkRef {
  /** El nombre de la ref tal y como git la lista. */
  readonly ref: string;
  /** El commit al que apunta. */
  readonly sha: string;
}

/** Un worktree del clon, con la rama en la que está. */
export interface IWorktree {
  /** La ruta del worktree. */
  readonly path: string;
  /** La rama del worktree; vacía si está en un commit suelto. */
  readonly branch: string;
}

/**
 * El nombre de la ref, sin el prefijo del sitio donde vive.
 *
 * `refs/heads/wip/x` y `refs/remotes/origin/wip/x` son la misma rama
 * vista desde dos sitios, y tienen que poder compararse.
 */
export function refName(ref: string): string {
  return ref
    .replace(/^refs\/heads\//u, "")
    .replace(/^refs\/remotes\/[^/]+\//u, "");
}

/**
 * ¿El nombre es el de una ref de trabajo o de publicación?
 *
 * Se acepta tanto la forma local (`refs/heads/wip/...`) como la de
 * seguimiento remoto (`refs/remotes/origin/wip/...`): son la misma
 * rama vista desde dos sitios.
 */
export function isWorkRef(ref: string): boolean {
  const name = refName(ref);
  return WORK_REF_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * La ref del forge a la que corresponde una ref de seguimiento.
 *
 * `refs/remotes/origin/wip/x` es `refs/heads/wip/x` en el forge, y es
 * esa la que se puede borrar. Sin esta traducción el remedio que el gate
 * propone no se puede aplicar.
 */
export function forgeRefOf(ref: string): string {
  return ref.replace(/^refs\/remotes\/[^/]+\//u, "refs/heads/");
}

/**
 * Las refs cuyo trabajo ya está en la rama de integración.
 *
 * La prueba de que el trabajo está entregado es la misma que hace el
 * runtime: el commit de la ref es **ancestro** del de la rama de
 * integración. No es "parecido" ni "contiene los mismos ficheros": es
 * que el commit está dentro de la historia, y por lo tanto su trabajo
 * está entregado.
 *
 * Y para una ref de **trabajo** hace falta una prueba más: que nadie
 * esté trabajando en ella. Una ref `wip/...` recién creada apunta al
 * mismo commit que la rama de integración, así que sin esa segunda
 * prueba toda unidad viva parecería integrada.
 */
export function integratedRefs(
  refs: readonly IWorkRef[],
  isAncestor: (sha: string) => boolean,
  worktreeBranches: readonly string[] = [],
): string[] {
  const worked = new Set(worktreeBranches);
  return refs
    .filter((each) => {
      if (!isAncestor(each.sha)) return false;
      const name = refName(each.ref);
      if (!name.startsWith("wip/")) return true;
      return !worked.has(name);
    })
    .map((each) => each.ref);
}

/**
 * Los worktrees del runtime que no están en ninguna ref de trabajo.
 *
 * Son los restos: el trabajo se integró (o se retiró) y el directorio se
 * quedó. El checkout principal no cuenta: no es un worktree del
 * runtime.
 */
export function huskWorktrees(
  worktrees: readonly IWorktree[],
  workBranches: readonly string[],
): string[] {
  const known = new Set(workBranches);
  return worktrees
    .filter(
      (each) =>
        each.branch.length > 0 &&
        !known.has(each.branch) &&
        each.path.startsWith(WORKTREE_ROOT),
    )
    .map((each) => each.path);
}

/** Las refs de trabajo y de publicación del clon, con su commit. */
async function readWorkRefs(): Promise<IWorkRef[]> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "for-each-ref",
      "--format=%(refname) %(objectname)",
      "refs/heads/wip/",
      "refs/heads/pr/",
      "refs/remotes/origin/wip/",
      "refs/remotes/origin/pr/",
    ],
    { cwd: REPO_ROOT },
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [ref = "", sha = ""] = line.split(" ");
      return { ref, sha };
    })
    .filter((each) => each.ref.length > 0 && each.sha.length > 0);
}

/** Los worktrees del clon, con su rama. */
async function readWorktrees(): Promise<IWorktree[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd: REPO_ROOT },
  );
  const worktrees: IWorktree[] = [];
  let path = "";
  let branch = "";
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (path.length > 0) worktrees.push({ path, branch });
      path = line.slice("worktree ".length).trim();
      branch = "";
    } else if (line.startsWith("branch ")) {
      branch = refName(line.slice("branch ".length).trim());
    }
  }
  if (path.length > 0) worktrees.push({ path, branch });
  return worktrees;
}

/** La rama de integración, y si este clon la tiene. */
async function integrationBranch(): Promise<string> {
  for (const candidate of ["origin/develop", "develop"]) {
    try {
      await execFileAsync(
        "git",
        ["rev-parse", "--verify", `${candidate}^{commit}`],
        { cwd: REPO_ROOT },
      );
      return candidate;
    } catch {
      // No está: se prueba la siguiente.
    }
  }
  return "HEAD";
}

async function main(): Promise<number> {
  const base = await integrationBranch();
  const refs = await readWorkRefs();
  const isAncestor = async (sha: string): Promise<boolean> => {
    try {
      await execFileAsync("git", ["merge-base", "--is-ancestor", sha, base], {
        cwd: REPO_ROOT,
      });
      return true;
    } catch {
      return false;
    }
  };

  const worktrees = await readWorktrees();
  const worktreeBranches = worktrees
    .map((each) => each.branch)
    .filter((branch) => branch.length > 0);
  const workBranches = refs
    .filter((each) => each.ref.startsWith("refs/heads/wip/"))
    .map((each) => refName(each.ref));

  // La ascendencia se pregunta commit a commit, porque `git` responde de
  // una en una; el predicado que recibe el gate ya sólo mira el
  // conjunto de las que están dentro.
  const landed = new Set<string>();
  for (const each of refs) {
    if (await isAncestor(each.sha)) landed.add(each.sha);
  }
  const integrated = integratedRefs(
    refs,
    (sha) => landed.has(sha),
    worktreeBranches,
  );
  const husks = huskWorktrees(worktrees, workBranches);

  if (integrated.length === 0 && husks.length === 0) {
    console.log(
      `lint:work-refs -- ${String(refs.length)} ref(s) de trabajo y publicación, ninguna ya integrada (integración: ${base}).`,
    );
    return 0;
  }

  console.error("lint:work-refs -- quedan restos de trabajo ya integrado:");
  for (const ref of integrated) {
    console.error(
      `  · ${ref} — su trabajo ya está en '${base}'. ` +
        `Bórrala con: delendai work retire --ref=${forgeRefOf(ref)} --reason="landed on develop"`,
    );
  }
  for (const path of husks) {
    console.error(
      `  · ${path} — el worktree no está en ninguna ref de trabajo. ` +
        `Recógelo con: delendai work reap --apply`,
    );
  }
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
