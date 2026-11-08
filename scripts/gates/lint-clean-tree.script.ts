#!/usr/bin/env bun
/**
 * `bun run lint:clean-tree` -- el árbol debe estar limpio tras el
 * `validate`. Lo activa c00005 S2.
 *
 * Por qué existe
 * ──────────────
 * Las revisiones de 2026-09-04/05 mostraron que el orquestador
 * multiagente dejaba residuos en el árbol del workspace:
 *
 *   - `.s1-msg.txt`, `.s2-msg.txt`, `.s3-msg.txt` en la raíz del repo
 *     (mensajes de commit temporales de cada slice), hoy ya fuera
 *     del repo gracias al `.gitignore` que añade c00005 S1, pero el
 *     gate se asegura de que no vuelvan a aparecer.
 *   - `n' hello-world`, `et ZSH_VERSION`: fragmentos de zsh-prompt que
 *     acababan en la raíz cuando un agente abría un subshell
 *     interactivo por error.
 *   - Salidas de `validate:examples` que el agente regenera sin
 *     commitear (colecciones Postman dentro de cada example).
 *
 * El gate mira `git status --porcelain --untracked-files=all` (incluye
 * los ignorados para diagnóstico) y falla si encuentra **cualquier**
 * entrada. La idea es: si tu árbol de trabajo tiene basura después de
 * `bun run validate`, el gate te lo dice con la lista exacta. No es
 * un sustituto de la disciplina del agente, es un detector.
 *
 * Excepciones
 * ───────────
 * - `TANIT_ALLOW_DIRTY=1` desactiva el gate (modo dev). Pensado para
 *   sesiones donde el agente está iterando y no quiere que cada
 *   `validate` interrumpa por un `package.json` modificado.
 * - Los `untracked` que ya están en `.gitignore` se reportan con
 *   severidad `info` y NO bloquean el gate -- el `.gitignore` ES la
 *   política; el gate solo detecta lo que se cuela por encima.
 *
 * Uso:
 *   bun run lint:clean-tree
 *   TANIT_ALLOW_DIRTY=1 bun run lint:clean-tree  # no falla
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { relative } from "node:path";
import { REPO_ROOT } from "../helpers/root.helper.js";

const execFileAsync = promisify(execFile);

/** Estado de `git status --porcelain --untracked-files=all`. */
interface IStatusEntry {
  /** XY -- los dos primeros chars del formato porcelain. */
  readonly xy: string;
  /** Ruta relativa a la raíz del repo. */
  readonly path: string;
  /** `true` si `??` (untracked) está en `.gitignore`. */
  readonly gitignored: boolean;
}

/** Salida de `git status --porcelain --ignored=traditional --untracked-files=all`. */
interface IGitStatus {
  readonly raw: string;
  readonly entries: ReadonlyArray<IStatusEntry>;
  readonly modifiedTracked: ReadonlyArray<IStatusEntry>;
  readonly untrackedIgnored: ReadonlyArray<IStatusEntry>;
  readonly untrackedNew: ReadonlyArray<IStatusEntry>;
  readonly stagedOrDeleted: ReadonlyArray<IStatusEntry>;
}

/**
 * Parsea `git status --porcelain --ignored=traditional --untracked-files=all`.
 *
 * Formato porcelain:
 *   XY path
 * Donde:
 *   X = estado staged (index)
 *   Y = estado working tree
 *
 *   `?? path`         untracked
 *   `!! path`         ignored (con --ignored=traditional)
 *   ` M path`         modified in working tree
 *   `M  path`         staged modified
 *   `D  path`         staged deleted
 *   ` D path`         deleted in working tree
 */
async function readGitStatus(): Promise<IGitStatus> {
  const { stdout } = await execFileAsync(
    "git",
    ["status", "--porcelain", "--ignored=traditional", "--untracked-files=all"],
    { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 },
  );
  const raw = stdout;
  const entries: IStatusEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const xy = line.slice(0, 2);
    const path = line.slice(3);
    const gitignored = xy === "!!";
    entries.push({ xy, path: relative(REPO_ROOT, path) || path, gitignored });
  }

  const modifiedTracked = entries.filter(
    (e) => !e.gitignored && (e.xy.includes("M") || e.xy.includes("D")),
  );
  const untrackedIgnored = entries.filter((e) => e.xy === "!!");
  const untrackedNew = entries.filter((e) => e.xy === "??");
  const stagedOrDeleted = entries.filter(
    (e) => !e.gitignored && (e.xy[0] !== " " && e.xy[0] !== "?"),
  );

  return { raw, entries, modifiedTracked, untrackedIgnored, untrackedNew, stagedOrDeleted };
}

export async function main(): Promise<number> {
  if (process.env.TANIT_ALLOW_DIRTY === "1") {
    console.log("lint:clean-tree -- desactivado por TANIT_ALLOW_DIRTY=1");
    return 0;
  }

  const status = await readGitStatus();

  // Categoría 1: basura "huérfana" -- untracked que NO está ignorada.
  // Esta es la clase que más importa: archivos que el agente o el
  // entorno crearon por accidente y no se molestaron en ignorar.
  // Lista exhaustiva de los patrones que aparecieron en las revisiones
  // de 2026-09-04/05:
  const ORPHAN_PATTERNS: ReadonlyArray<RegExp> = [
    /^\.s[0-9]+-msg\.txt$/,
    /^[a-z]'\s/, // 'n foo', ' et ZSH_VERSION' (residuos de zsh)
    /^'/,
    /^examples\/[^/]+\/export-to-postman\/[^/]+\.json$/,
    /^__tanit_tmp__\//,
  ];
  const orphans = status.untrackedNew.filter((e) =>
    ORPHAN_PATTERNS.some((re) => re.test(e.path)),
  );

  // Categoría 2: archivos modificados o borrados en el árbol. En CI
  // deberían ser cero (nadie commitea durante el validate). En dev
  // pueden existir legítimamente -- pero el gate los reporta siempre.
  const dirty = [...status.modifiedTracked, ...status.stagedOrDeleted];

  if (orphans.length === 0 && dirty.length === 0 && status.untrackedNew.length === 0) {
    console.log(
      `lint:clean-tree -- árbol limpio (${status.entries.length} entradas totales, ` +
        `${status.untrackedIgnored.length} ignoradas por .gitignore)`,
    );
    return 0;
  }

  console.error(`lint:clean-tree -- ${orphans.length + dirty.length + status.untrackedNew.length} problema(s):\n`);

  if (orphans.length > 0) {
    console.error(`  ✗ Huérfanos (untracked, no en .gitignore):`);
    for (const e of orphans) console.error(`      ${e.xy} ${e.path}`);
  }

  if (dirty.length > 0) {
    console.error(`  ✗ Modificados/borrados (tracked):`);
    for (const e of dirty) console.error(`      ${e.xy} ${e.path}`);
  }

  if (status.untrackedNew.length > 0) {
    console.error(`  ✗ Untracked (nuevos ficheros no versionados):`);
    for (const e of status.untrackedNew) console.error(`      ${e.xy} ${e.path}`);
  }

  if (status.untrackedIgnored.length > 0) {
    console.error(
      `\n  · Ignorados por .gitignore (informativo, no bloquean): ${status.untrackedIgnored.length}`,
    );
  }

  console.error(
    `\n  Sugerencia: añade el patrón a .gitignore o usa TANIT_ALLOW_DIRTY=1 para saltarte el gate en dev.`,
  );
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
