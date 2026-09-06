#!/usr/bin/env bun
/**
 * Lint de propuestas: la carpeta tiene que coincidir con el `status`.
 *
 * Es la misma regla que aplica `delendai` (su
 * `proposal-folder-drift.script.ts`). Sin ella el árbol miente en cuanto
 * alguien cambia el frontmatter y se olvida de mover el fichero, o al
 * revés — y entonces `ready/` deja de ser una lista fiable de qué queda
 * por hacer.
 *
 * Comprueba las invariantes de x00032 (cierre coherente):
 *   1. El `status` es uno de los estados válidos.
 *   2. La carpeta corresponde a ese estado.
 *   3. Dentro de `done/`, la subcarpeta corresponde al `kind`.
 *   4. Los `id` no se repiten y coinciden con el prefijo del fichero.
 *   5. El esqueleto de carpetas existe entero y cada una tiene `.gitkeep`.
 *   6. (x00032 S1) Una propuesta `status: done` cuyo `kind` no sea
 *      `audit` NO puede tener slices con `**Status**: pending`,
 *      `in-progress` o `blocked` en su cuerpo. El cierre se demuestra
 *      en el cuerpo, no en el frontmatter. Las auditorías se saltan
 *      esta regla porque sus slices son recomendaciones aspiracionales
 *      que abren OTROS `kind: fix|chore|feat` — no trabajo de la propia
 *      auditoría.
 *   7. (x00032 S1) Una propuesta `status: done` debe llevar `shippedIn:`
 *      con al menos un SHA. Y cada SHA debe ser alcanzable en git
 *      (`git cat-file -e <sha>` responde 0). Un SHA falso es peor que
 *      no tener SHA, porque miente sobre la auditoría de evidencias.
 *   8. (x00032 S1) El `INDEX.md` no lista propuestas `done` en la
 *      sección "Ready"; toda propuesta `ready` aparece en su tabla.
 *
 * Uso:
 *   bun run lint:proposals
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, join, relative, } from "node:path";
import { PROPOSALS_DIR, REPO_ROOT } from "../helpers/root.helper.js";

const execFileAsync = promisify(execFile);

/** Estados válidos y su carpeta. Coinciden 1:1 por diseño. */
const STATES = [
  "ready",
  "in-progress",
  "review",
  "done",
  "paused",
  "blocked",
  "retired",
  "legacy",
] as const;

/** `kind` → subcarpeta dentro de `done/`. */
const KIND_DIRS: Record<string, string> = {
  feat: "feats",
  fix: "fixes",
  chore: "chores",
  docs: "docs",
  refactor: "refactors",
  test: "tests",
  audit: "audits",
  perf: "perfs",
  plan: "plans",
  resume: "resumes",
  // Los cuatro de abajo faltaban, y no eran teóricos: el servidor MCP
  // los acepta en `create_proposal`, así que una propuesta creada con la
  // herramienta oficial no tenía dónde archivarse. Se vio al cerrar
  // `i00001`, que es `kind: infra`.
  //
  // Una lista que no coincide con la del servidor es la misma clase de
  // drift que el bootstrap describiendo una arquitectura sustituida:
  // dos fuentes de verdad para lo mismo.
  breaking: "breakings",
  infra: "infras",
  spike: "spikes",
  legacy: "legacies",
};

/**
 * Esqueleto completo de carpetas, derivado de los dos mapas de arriba
 * para que no pueda desincronizarse: si mañana se añade un estado o un
 * `kind`, la carpeta entra sola en el lint.
 */
function canonicalFolders(): string[] {
  const folders = STATES.map((state) => state as string);
  for (const dir of new Set(Object.values(KIND_DIRS))) folders.push(join("done", dir));
  return folders.sort();
}

interface IProposal {
  readonly path: string;
  readonly id: string;
  readonly status: string;
  readonly kind: string;
  /** Texto completo del fichero (frontmatter + cuerpo). */
  readonly body: string;
  /** Texto tras el segundo `---` (sólo cuerpo). */
  readonly bodyAfter: string;
  /** Bloque de frontmatter (entre los dos `---`). */
  readonly frontmatter: string;
}

function readField(frontmatter: string, name: string): string {
  const match = new RegExp(`^${name}:\\s*(.+)$`, "m").exec(frontmatter);
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

/**
 * Parsea el frontmatter YAML-like y devuelve los `shippedIn: [...]` SHAs.
 *
 * Acepta dos formas (lo que aparece en el repo):
 *
 *   shippedIn:
 *     - cc134ce  # comentario
 *     - 3f6b533
 *
 *   shippedIn: [cc134ce, 3f6b533]
 *
 * Si el campo no existe o está vacío, devuelve `[]`.
 */
function parseShippedIn(body: string): string[] {
  const block = body.match(/^shippedIn:\s*\n((?:\s*-\s*\S+\s*(?:#.*)?\s*\n?)+)/m);
  if (block && block[1] !== undefined) {
    const out: string[] = [];
    for (const line of block[1].split("\n")) {
      const sha = line.match(/-\s*([0-9a-f]{7,40})\b/i)?.[1];
      if (sha) out.push(sha);
    }
    return out;
  }
  const inline = body.match(/^shippedIn:\s*\[([^\]]+)\]/m);
  if (inline) {
    return (inline[1] ?? "")
      .split(",")
      .map((s) => s.trim().match(/([0-9a-f]{7,40})/i)?.[1] ?? "")
      .filter(Boolean);
  }
  return [];
}

/**
 * Busca las marcas `**Status**: <value>` en el cuerpo de la propuesta.
 *
 * Solo cuenta las que estén bajo una sección `## Slices` (x00032 S1).
 * Devuelve la lista de estados que aparecen.
 */
function parseSliceStatuses(bodyAfter: string): string[] {
  const slicesIdx = bodyAfter.indexOf("\n## Slices");
  if (slicesIdx < 0) return [];
  const afterSlices = bodyAfter.slice(slicesIdx);
  // El siguiente `## ` que no sea "Slices" cierra la sección.
  const nextSection = afterSlices.search(/\n## [^S\n]|\n## S[^l]|\n## Sl[^i]/);
  const end = nextSection > 0 ? nextSection : afterSlices.length;
  const block = afterSlices.slice(0, end);
  const re = /\*\*Status\*\*:\s*([A-Za-z_-]+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const v = m[1];
    if (v !== undefined) out.push(v.toLowerCase());
  }
  return out;
}

async function collectProposals(dir: string): Promise<IProposal[]> {
  const out: IProposal[] = [];
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectProposals(full)));
      continue;
    }
    if (
      !entry.name.endsWith(".md") ||
      entry.name === "README.md" ||
      entry.name === "INDEX.md"
    ) continue;

    const text = await readFile(full, "utf8");
    const parts = text.split("---");
    const frontmatter = text.startsWith("---") ? (parts[1] ?? "") : "";
    const bodyAfter = text.startsWith("---") ? parts.slice(2).join("---") : text;
    out.push({
      path: full,
      id: readField(frontmatter, "id"),
      status: readField(frontmatter, "status"),
      kind: readField(frontmatter, "kind"),
      body: text,
      bodyAfter,
      frontmatter,
    });
  }
  return out;
}

/** Carpeta donde debería vivir una propuesta según su frontmatter. */
function expectedFolder(proposal: IProposal): string {
  if (proposal.status !== "done") return proposal.status;
  return join("done", KIND_DIRS[proposal.kind] ?? "chores");
}

/** ¿La propuesta usa la subcarpeta opcional correspondiente a su kind? */
function isKindScopedFolder(proposal: IProposal, actual: string): boolean {
  const kindDir = KIND_DIRS[proposal.kind];
  return kindDir !== undefined && actual === join(proposal.status, kindDir);
}

/** ¿Existe la ruta y es del tipo esperado? */
async function exists(path: string, kind: "dir" | "file"): Promise<boolean> {
  try {
    const info = await stat(path);
    return kind === "dir" ? info.isDirectory() : info.isFile();
  } catch {
    return false;
  }
}

/**
 * Verifica que están las carpetas de todos los estados (y las de `kind`
 * dentro de `done/`), cada una con su `.gitkeep`.
 */
async function checkSkeleton(): Promise<string[]> {
  const problems: string[] = [];
  const root = relative(REPO_ROOT, PROPOSALS_DIR);

  if (!(await exists(join(PROPOSALS_DIR, ".gitkeep"), "file"))) {
    problems.push(`${root}/: falta el .gitkeep de la raíz`);
  }

  for (const folder of canonicalFolders()) {
    const dir = join(PROPOSALS_DIR, folder);
    if (!(await exists(dir, "dir"))) {
      problems.push(`${root}/${folder}/: la carpeta no existe`);
      continue;
    }
    if (!(await exists(join(dir, ".gitkeep"), "file"))) {
      problems.push(
        `${root}/${folder}/: falta el .gitkeep — git borraría la carpeta al quedarse vacía`,
      );
    }
  }
  return problems;
}

/**
 * Comprueba que un SHA es alcanzable en git. Devuelve true si
 * `git cat-file -e <sha>` responde 0.
 */
async function isReachableSha(sha: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["cat-file", "-e", sha], { cwd: REPO_ROOT });
    return true;
  } catch {
    return false;
  }
}

/**
 * x00032 S2 (regla 5): INDEX.md no debe listar propuestas `done` en
 * la tabla "Ready", y toda propuesta `ready`/`blocked` debe aparecer
 * en su tabla correspondiente. Verifica contra el filesystem; el
 * regenerado automático es un slice posterior (S2.2).
 *
 * Solo miramos dentro de las filas de tabla markdown (líneas que
 * empiezan por `|`). Una mención en prosa — por ejemplo una nota
 * histórica al pie — no cuenta como "listada".
 */
async function checkIndexSync(proposals: ReadonlyArray<IProposal>): Promise<string[]> {
  const problems: string[] = [];
  const indexPath = join(PROPOSALS_DIR, "INDEX.md");
  if (!(await exists(indexPath, "file"))) {
    return [`INDEX.md falta en ${relative(REPO_ROOT, PROPOSALS_DIR)}/`];
  }
  const indexText = await readFile(indexPath, "utf8");

  // Cada propuesta se referencia en INDEX.md por su id en una línea
  // tipo "| `id` | ...". Buscamos SOLO dentro de filas de tabla.
  const indexIds = new Set<string>();
  for (const line of indexText.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const m = line.match(/`([a-zA-Z]\d{5})`/);
    if (m && m[1]) indexIds.add(m[1]);
  }

  const proposalsByStatus = new Map<string, IProposal[]>();
  for (const p of proposals) {
    const list = proposalsByStatus.get(p.status) ?? [];
    list.push(p);
    proposalsByStatus.set(p.status, list);
  }

  // 1) Listadas en una tabla de INDEX.md pero ya están `done`.
  const doneIds = new Set(
    (proposalsByStatus.get("done") ?? []).map((p) => p.id).filter(Boolean),
  );
  for (const id of doneIds) {
    if (indexIds.has(id)) {
      problems.push(
        `INDEX.md lista \`${id}\` en una tabla pero su frontmatter está en status: done`,
      );
    }
  }

  // 2) Listadas como `ready`/`blocked` pero NO aparecen en INDEX.md.
  for (const status of ["ready", "blocked"] as const) {
    for (const p of proposalsByStatus.get(status) ?? []) {
      if (p.id && !indexIds.has(p.id)) {
        problems.push(
          `${relative(REPO_ROOT, p.path)}: status "${status}" pero \`${p.id}\` no aparece en INDEX.md`,
        );
      }
    }
  }

  return problems;
}

export async function main(): Promise<number> {
  const proposals = await collectProposals(PROPOSALS_DIR);
  if (proposals.length === 0) {
    console.error("lint:proposals — no se encontró ninguna propuesta");
    return 1;
  }

  const problems: string[] = await checkSkeleton();
  const seenIds = new Map<string, string>();

  for (const proposal of proposals) {
    const rel = relative(REPO_ROOT, proposal.path);

    if (!proposal.id) {
      problems.push(`${rel}: falta \`id\` en el frontmatter`);
    } else {
      const previous = seenIds.get(proposal.id);
      if (previous) problems.push(`${rel}: el id ${proposal.id} ya está en ${previous}`);
      else seenIds.set(proposal.id, rel);

      if (!basename(proposal.path).startsWith(`${proposal.id}-`)) {
        problems.push(
          `${rel}: el nombre del fichero no empieza por su id (${proposal.id})`,
        );
      }
    }

    if (!STATES.includes(proposal.status as (typeof STATES)[number])) {
      problems.push(
        `${rel}: status "${proposal.status}" no es válido (${STATES.join(", ")})`,
      );
      continue;
    }

    const actual = relative(PROPOSALS_DIR, proposal.path).split("/").slice(0, -1).join("/");
    const expected = expectedFolder(proposal);
    if (actual !== expected && !isKindScopedFolder(proposal, actual)) {
      problems.push(
        `${rel}: status "${proposal.status}" pero vive en ${actual || "(raíz)"}/ — debería estar en ${expected}/`,
      );
    }

    // ── x00032 S1 — coherencia frontmatter ↔ cuerpo ──────────────────
    if (proposal.status === "done" && proposal.kind !== "audit") {
      // Regla 1: ningún slice `pending`/`in-progress`/`blocked` en el cuerpo.
      const OPEN = ["pending", "in-progress", "blocked"];
      const sliceStatuses = parseSliceStatuses(proposal.bodyAfter);
      const offending = sliceStatuses.filter((s) => OPEN.includes(s));
      if (offending.length > 0) {
        problems.push(
          `${rel}: status "done" pero ${offending.length} slice(s) en el cuerpo siguen en ` +
            `[${offending.join(", ")}] — x00032 S1 (regla 1)`,
        );
      }

      // Regla 2: `shippedIn` no vacío y SHAs alcanzables.
      const shas = parseShippedIn(proposal.body);
      if (shas.length === 0) {
        problems.push(
          `${rel}: status "done" pero \`shippedIn:\` está vacío — x00032 S1 (regla 2)`,
        );
      } else {
        for (const sha of shas) {
          if (!(await isReachableSha(sha))) {
            problems.push(
              `${rel}: shippedIn lista \`${sha}\` que no es alcanzable en git — x00032 S1 (regla 2)`,
            );
          }
        }
      }
    }
  }

  problems.push(...(await checkIndexSync(proposals)));

  if (problems.length > 0) {
    console.error(`lint:proposals — ${problems.length} problema(s):\n`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    return 1;
  }

  // x00032 S2: `INDEX.md` debe coincidir byte-a-byte con la versión
  // regenerada por `gen-index.script.ts`. El check se hace aquí
  // (en lugar de como gate separado) porque cualquier drift de
  // INDEX es, por definición, una violación de `lint:proposals`:
  // las reglas S1 no sirven si la lista humana de "ready" y la
  // realidad del filesystem divergen. Si drift aparece, el
  // mensaje apunta al comando para arreglarlo.
  const { spawn } = await import("node:child_process");
  const regen = await new Promise<{ code: number; out: string; err: string }>(
    (resolve) => {
      const child = spawn(
        "bun",
        ["run", "scripts/gates/gen-index.script.ts", "--check"],
        { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
      );
      const out: Uint8Array[] = [];
      const err: Uint8Array[] = [];
      child.stdout.on("data", (c: Uint8Array) => out.push(c));
      child.stderr.on("data", (c: Uint8Array) => err.push(c));
      child.on("close", (code) => {
        const decoder = new TextDecoder();
        resolve({
          code: code ?? 1,
          out: out.map((c) => decoder.decode(c)).join(""),
          err: err.map((c) => decoder.decode(c)).join(""),
        });
      });
    },
  );
  if (regen.code !== 0) {
    problems.push(
      `INDEX.md no coincide con la versión regenerada. Corre \`bun run lint:proposals:gen-index\` y commitea el resultado.` +
        (regen.err ? `\n  · regenerador: ${regen.err.trim()}` : ""),
    );
  }

  const byState = new Map<string, number>();
  for (const p of proposals) byState.set(p.status, (byState.get(p.status) ?? 0) + 1);
  const summary = [...byState.entries()]
    .sort()
    .map(([state, count]) => `${state} ${count}`)
    .join(", ");
  console.log(
    `lint:proposals — ${proposals.length} propuestas, sin drift (${summary})` +
      ` · esqueleto de ${canonicalFolders().length} carpetas anclado con .gitkeep` +
      ` · x00032 S1: frontmatter↔cuerpo coherente, INDEX sincronizado`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
