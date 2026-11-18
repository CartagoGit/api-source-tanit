#!/usr/bin/env bun
/**
 * `bun run lint:work-refs` -- ninguna rama de trabajo ni de publicación
 * sobrevive a su integración.
 *
 * Por qué existe
 * ──────────────
 * Una unidad de trabajo publica su trabajo en una rama (`pr/...`) y
 * trabaja en otra (`wip/...`). Cuando ese trabajo aterriza en `develop`,
 * las dos refs dejan de guardar nada, y se quedan: el clon se llena de
 * ramas que nadie sabe si son trabajo vivo o trabajo ya integrado.
 *
 * El runtime sabe limpiarlo (`delendai work reap`, `delendai work
 * retire`, `delendai work doctor`), pero sólo se le pregunta. Este gate
 * es el que lo pregunta en cada `lint`, y el que dice qué sobra.
 *
 * Cómo lo sabe
 * ────────────
 * El runtime lleva la cuenta de qué es una unidad viva, de qué es un
 * resto y de cómo se limpia cada cosa. Su `work doctor` lo dice, check a
 * check, con el remedio de cada check. Este gate **le pregunta
 * primero**: con el runtime instalado (`delendai --json work doctor`)
 * usa sus veredictos y sus remedios, palabra por palabra.
 *
 * Sin runtime --la CI de este repo no lo instala, porque el runtime vive
 * en otro repositorio-- el gate hace la misma pregunta con `git`, que es
 * lo único que hace falta: si el commit de la ref es ancestro del de la
 * rama de integración. Los dos modos hablan de lo mismo con los mismos
 * nombres (`DOCTOR_CHECKS`), así que el veredicto es el mismo; sólo
 * cambia quién lo pronuncia.
 *
 * La limpieza la hace siempre el runtime. Este gate no borra nada: dice
 * qué sobra y con qué comando se quita.
 *
 * Qué mira
 * ────────
 * Los cuatro veredictos que hablan de restos. Los demás son del runtime
 * y no de este gate: el stash, las claims, el estado del checkout, las
 * ramas que el perfil no conoce.
 *
 * | veredicto | qué es un resto |
 * |---|---|
 * | `publications-hold-work` | una publicación (`pr/`) cuyo trabajo ya está integrado |
 * | `no-abandoned-work-refs` | una ref de trabajo (`wip/`) local sin worktree encima |
 * | `no-leftover-worktrees` | un worktree que no está en ninguna ref de trabajo |
 * | `no-husk-directories` | un directorio junto a las unidades que no es una unidad |
 *
 * Qué NO mira
 * ──────────
 * - El trabajo **no** integrado: una ref cuyo commit no está en
 *   `develop` es una unidad viva, y borrarla sería tirar trabajo.
 * - Las refs de trabajo **del forge** (`wip/...` en `origin`): el
 *   runtime las deja a propósito, como archivo del trabajo ya
 *   integrado. No son un resto: son donde está el trabajo.
 * - Los claims del runtime (`refs/delendai/claims/...`) y las refs
 *   retiradas (`refs/retired/...`): son suyos, y los suelta él.
 *
 * Uso:
 *   bun run lint:work-refs
 */
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import { REPO_ROOT } from "../helpers/root.helper.js";

const execFileAsync = promisify(execFile);

/** Los prefijos de ref que son de trabajo o de publicación. */
export const WORK_REF_PREFIXES = ["wip/", "pr/"] as const;

/**
 * Dónde viven las unidades del runtime, dentro del checkout compartido.
 */
export const UNITS_RELATIVE = ".cache/delendai/.worktrees";

/**
 * El checkout compartido, y no el worktree desde el que se corre.
 *
 * El runtime piensa igual (`--git-common-dir`): desde un worktree, el
 * repositorio es el checkout que lo contiene, y las refs, los worktrees
 * y las unidades son de aquél. Sin esto, el checkout principal parecería
 * un worktree sobrante --está en la lista de `git worktree list` y no
 * está en ninguna ref de trabajo-- y el gate fallaría siempre que se
 * corra desde dentro de una unidad.
 */
export async function sharedCheckout(): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--git-common-dir"],
    { cwd: REPO_ROOT },
  );
  const common = stdout.trim();
  const absolute = isAbsolute(common) ? common : resolve(REPO_ROOT, common);
  return dirname(absolute);
}

/** La carpeta de unidades del runtime, en el checkout compartido. */
export function unitsDirectory(shared: string): string {
  return resolve(shared, UNITS_RELATIVE);
}

/**
 * Los veredictos del doctor que este gate consulta.
 *
 * Son los que hablan de restos, y son cuatro porque el runtime tiene
 * cuatro formas de dejar algo atrás.
 */
export const DOCTOR_CHECKS = [
  "publications-hold-work",
  "no-abandoned-work-refs",
  "no-leftover-worktrees",
  "no-husk-directories",
] as const;

/**
 * Cuánto se deja pasar un directorio recién tocado antes de culparlo.
 *
 * Es la carrera de `work enter`: crea el directorio y luego registra el
 * worktree. Un directorio que se acaba de tocar no es un resto.
 */
export const HUSK_QUIET_MS = 60_000;

/** Un veredicto: lo que el doctor dice de una cosa. */
export interface IVerdict {
  /** El identificador del check. */
  readonly id: string;
  /** Si el check se sostiene. */
  readonly holds: boolean;
  /** Lo que el check vio. */
  readonly observed: string;
  /** Cómo se arregla. */
  readonly remedy: string;
}

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

/** Un directorio junto a las unidades, con lo último que se tocó. */
export interface IUnitDirectory {
  /** El nombre del directorio. */
  readonly name: string;
  /** La ruta del directorio. */
  readonly path: string;
  /** Cuándo se tocó por última vez, en milisegundos. */
  readonly touchedAt: number;
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
 * Las publicaciones del clon, una por rama.
 *
 * La misma publicación se ve desde dos sitios: la rama local y su
 * seguimiento remoto. Del par se queda la del forge, que es la que sabe
 * el estado del trabajo.
 */
export function publicationsOf(refs: readonly IWorkRef[]): IWorkRef[] {
  const byName = new Map<string, IWorkRef>();
  for (const each of refs) {
    const name = refName(each.ref);
    if (!name.startsWith("pr/")) continue;
    const known = byName.get(name);
    if (known === undefined || each.ref.startsWith("refs/remotes/")) {
      byName.set(name, each);
    }
  }
  return [...byName.values()];
}

/**
 * Las publicaciones cuyo trabajo ya está en la rama de integración.
 *
 * La prueba de que el trabajo está entregado es la misma que hace el
 * runtime: el commit de la ref es **ancestro** del de la rama de
 * integración. No es "parecido" ni "contiene los mismos ficheros": es
 * que el commit está dentro de la historia, y por lo tanto su trabajo
 * está entregado.
 */
export function spentPublications(
  refs: readonly IWorkRef[],
  isAncestor: (sha: string) => boolean,
): string[] {
  return publicationsOf(refs)
    .filter((each) => isAncestor(each.sha))
    .map((each) => refName(each.ref));
}

/**
 * Las refs de trabajo locales que no tienen un worktree encima.
 *
 * Una ref de trabajo sin worktree es una ref que nadie sostiene: su
 * agente ya no trabaja en ella. El runtime las deja ahí cuando la
 * unidad se publica o se abandona, y por eso son las que el doctor
 * cuenta como abandonadas.
 */
export function abandonedWorkRefs(
  refs: readonly IWorkRef[],
  worktreeBranches: readonly string[],
): string[] {
  const worked = new Set(worktreeBranches);
  return refs
    .filter((each) => each.ref.startsWith("refs/heads/wip/"))
    .filter((each) => !worked.has(refName(each.ref)))
    .map((each) => refName(each.ref));
}

/**
 * Los worktrees que no están en ninguna ref de trabajo.
 *
 * El checkout principal no cuenta: no es un worktree del runtime.
 */
export function leftoverWorktrees(
  worktrees: readonly IWorktree[],
  root: string,
): string[] {
  return worktrees
    .filter((each) => each.path !== root)
    .filter((each) => !each.branch.startsWith("wip/"))
    .map((each) => each.path);
}

/**
 * Los directorios de las unidades que no son worktrees.
 *
 * Son los restos: la unidad se integrationsó (o se retiró) y el
 * directorio se quedó. Un directorio recién tocado no cuenta: es la
 * carrera de `work enter`, que crea el directorio y luego registra el
 * worktree.
 */
export function huskDirectories(
  worktrees: readonly IWorktree[],
  units: readonly IUnitDirectory[],
  nowMs: number,
  quietMs: number = HUSK_QUIET_MS,
): string[] {
  return units
    .filter((unit) => nowMs - unit.touchedAt > quietMs)
    .filter(
      (unit) =>
        !worktrees.some(
          (worktree) =>
            worktree.path === unit.path ||
            worktree.path.startsWith(`${unit.path}/`),
        ),
    )
    .map((unit) => unit.name);
}

/** Los veredictos que el gate mira, y de ellos los que fallan. */
export function failedVerdicts(
  verdicts: readonly IVerdict[],
  ids: readonly string[] = DOCTOR_CHECKS,
): IVerdict[] {
  const watched = new Set(ids);
  return verdicts.filter((each) => watched.has(each.id) && !each.holds);
}

/**
 * Los veredictos que trae el informe del doctor.
 *
 * El informe del runtime trae más checks de los que este gate mira; lo
 * que interesa aquí es poder leer los suyos.
 */
export function parseDoctorReport(raw: string): IVerdict[] {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return [];
  const results: unknown = (parsed as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const verdicts: IVerdict[] = [];
  for (const each of results) {
    if (typeof each !== "object" || each === null) continue;
    const record = each as Record<string, unknown>;
    const id = record["id"];
    const holds = record["holds"];
    if (typeof id !== "string" || typeof holds !== "boolean") continue;
    const observed = record["observed"];
    const remedy = record["remedy"];
    verdicts.push({
      id,
      holds,
      observed: typeof observed === "string" ? observed : "",
      remedy: typeof remedy === "string" ? remedy : "",
    });
  }
  return verdicts;
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

/** Los directorios que hay junto a las unidades. */
async function readUnitDirectories(
  unitsRoot: string,
): Promise<IUnitDirectory[]> {
  let names: string[];
  try {
    names = await readdir(unitsRoot);
  } catch {
    return [];
  }
  const units: IUnitDirectory[] = [];
  for (const name of names) {
    const path = resolve(unitsRoot, name);
    try {
      const info = await stat(path);
      if (!info.isDirectory()) continue;
      units.push({ name, path, touchedAt: info.mtimeMs });
    } catch {
      // Se fue mientras se miraba: no hay nada que decir de él.
    }
  }
  return units;
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

/** Si el commit está dentro de la historia de la rama de integración. */
async function isAncestorOf(sha: string, base: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", sha, base], {
      cwd: REPO_ROOT,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Los veredictos que el gate calcula con `git`, sin el runtime.
 *
 * Mismo contrato que el doctor: los mismos identificadores, la misma
 * pregunta y el mismo remedio. Lo que cambia es quién contesta.
 */
async function localVerdicts(): Promise<IVerdict[]> {
  const base = await integrationBranch();
  const shared = await sharedCheckout();
  const refs = await readWorkRefs();
  const worktrees = await readWorktrees();
  const units = await readUnitDirectories(unitsDirectory(shared));

  // La ascendencia se pregunta commit a commit, porque `git` responde de
  // una en una; el predicado que recibe el gate ya sólo mira el conjunto
  // de las que están dentro.
  const landed = new Set<string>();
  for (const each of refs) {
    if (await isAncestorOf(each.sha, base)) landed.add(each.sha);
  }
  const isAncestor = (sha: string): boolean => landed.has(sha);

  const publications = publicationsOf(refs);
  const spent = spentPublications(refs, isAncestor);
  const localWork = refs.filter((each) => each.ref.startsWith("refs/heads/wip/"));
  const abandoned = abandonedWorkRefs(
    refs,
    worktrees.map((each) => each.branch).filter((branch) => branch.length > 0),
  );
  const leftovers = leftoverWorktrees(worktrees, shared);
  const husks = huskDirectories(worktrees, units, Date.now());

  const first = (each: readonly string[]): string => each[0] ?? "";
  const listed = (each: readonly string[]): string =>
    each.slice(0, 3).join(", ");

  return [
    {
      id: "publications-hold-work",
      holds: spent.length === 0,
      observed:
        publications.length === 0
          ? "no publication refs"
          : spent.length === 0
            ? `${String(publications.length)} ref(s), all holding work`
            : `${String(spent.length)} spent: ${listed(spent)}`,
      remedy:
        spent.length === 0
          ? ""
          : `its commits are already on \`${base}\`: retire it (\`delendai work retire --ref=refs/heads/${first(spent)} --reason="landed on ${base}"\`)`,
    },
    {
      id: "no-abandoned-work-refs",
      holds: abandoned.length === 0,
      observed:
        localWork.length === 0
          ? "no work refs"
          : abandoned.length === 0
            ? `${String(localWork.length)} live, none abandoned`
            : `${String(abandoned.length)}: ${listed(abandoned)}`,
      remedy:
        abandoned.length === 0
          ? ""
          : `publish it (\`delendai work publish\`), or retire it with its work kept (\`delendai work retire --ref=refs/heads/${first(abandoned)} --reason=<why>\`)`,
    },
    {
      id: "no-leftover-worktrees",
      holds: leftovers.length === 0,
      observed:
        worktrees.length <= 1
          ? "none"
          : leftovers.length === 0
            ? `${String(worktrees.length - 1)} working`
            : `${String(leftovers.length)}: ${listed(leftovers)}`,
      remedy:
        leftovers.length === 0
          ? ""
          : `git worktree remove --force ${first(leftovers)}`,
    },
    {
      id: "no-husk-directories",
      holds: husks.length === 0,
      observed: husks.length === 0 ? "none" : `${String(husks.length)}: ${listed(husks)}`,
      remedy:
        husks.length === 0
          ? ""
          : "`delendai work reap --apply` keeps on the forge whatever they hold that no commit has, then removes them",
    },
  ];
}

/**
 * El informe del doctor, si el runtime está y contesta.
 *
 * El doctor sale con código 4 cuando encuentra algo roto: su informe
 * sigue siendo la respuesta, así que un error con salida a stdout es un
 * informe, no un fallo.
 */
async function doctorReport(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "delendai",
      ["--json", "work", "doctor"],
      { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    return stdout;
  } catch (error) {
    const stdout: unknown = (error as { stdout?: unknown }).stdout;
    return typeof stdout === "string" ? stdout : undefined;
  }
}

/** Los veredictos del doctor, o `undefined` si no se pudo preguntar. */
export async function doctorVerdicts(): Promise<IVerdict[] | undefined> {
  const report = await doctorReport();
  if (report === undefined) return undefined;
  try {
    const verdicts = parseDoctorReport(report);
    return verdicts.length === 0 ? undefined : verdicts;
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const fromDoctor = await doctorVerdicts();
  const verdicts = fromDoctor ?? (await localVerdicts());
  const failed = failedVerdicts(verdicts);
  const source = fromDoctor === undefined ? "git (sin runtime)" : "el doctor del runtime";

  if (failed.length === 0) {
    console.log(
      `lint:work-refs -- ${String(DOCTOR_CHECKS.length)} veredicto(s) (${source}): ningún resto de trabajo ya integrado.`,
    );
    return 0;
  }

  console.error("lint:work-refs -- quedan restos de trabajo ya integrado:");
  for (const each of failed) {
    console.error(`  · ${each.id} — ${each.observed}`);
    if (each.remedy.length > 0) console.error(`    ${each.remedy}`);
  }
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
