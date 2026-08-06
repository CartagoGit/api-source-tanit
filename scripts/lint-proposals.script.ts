#!/usr/bin/env bun
/**
 * Lint de propuestas: la carpeta tiene que coincidir con el `status`.
 *
 * Es la misma regla que aplica `mcp-vertex` (su
 * `proposal-folder-drift.script.ts`). Sin ella el árbol miente en cuanto
 * alguien cambia el frontmatter y se olvida de mover el fichero, o al
 * revés — y entonces `ready/` deja de ser una lista fiable de qué queda
 * por hacer.
 *
 * Comprueba cuatro cosas:
 *   1. El `status` es uno de los estados válidos.
 *   2. La carpeta corresponde a ese estado.
 *   3. Dentro de `done/`, la subcarpeta corresponde al `kind`.
 *   4. Los `id` no se repiten y coinciden con el prefijo del fichero.
 *
 * Uso:
 *   bun run lint:proposals
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const PROPOSALS_DIR = join(PACKAGE_ROOT, "docs", "mcp-vertex", "proposals");

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
};

interface IProposal {
  readonly path: string;
  readonly id: string;
  readonly status: string;
  readonly kind: string;
}

function readField(frontmatter: string, name: string): string {
  const match = new RegExp(`^${name}:\\s*(.+)$`, "m").exec(frontmatter);
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

async function collectProposals(dir: string): Promise<IProposal[]> {
  const out: IProposal[] = [];
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as never;
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectProposals(full)));
      continue;
    }
    if (!entry.name.endsWith(".md") || entry.name === "README.md") continue;

    const text = await readFile(full, "utf8");
    const frontmatter = text.startsWith("---") ? (text.split("---")[1] ?? "") : "";
    out.push({
      path: full,
      id: readField(frontmatter, "id"),
      status: readField(frontmatter, "status"),
      kind: readField(frontmatter, "kind"),
    });
  }
  return out;
}

/** Carpeta donde debería vivir una propuesta según su frontmatter. */
function expectedFolder(proposal: IProposal): string {
  if (proposal.status !== "done") return proposal.status;
  return join("done", KIND_DIRS[proposal.kind] ?? "chores");
}

async function main(): Promise<number> {
  const proposals = await collectProposals(PROPOSALS_DIR);
  if (proposals.length === 0) {
    console.error("lint:proposals — no se encontró ninguna propuesta");
    return 1;
  }

  const problems: string[] = [];
  const seenIds = new Map<string, string>();

  for (const proposal of proposals) {
    const rel = relative(PACKAGE_ROOT, proposal.path);

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
    if (actual !== expected) {
      problems.push(
        `${rel}: status "${proposal.status}" pero vive en ${actual || "(raíz)"}/ — debería estar en ${expected}/`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(`lint:proposals — ${problems.length} problema(s):\n`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    return 1;
  }

  const byState = new Map<string, number>();
  for (const p of proposals) byState.set(p.status, (byState.get(p.status) ?? 0) + 1);
  const summary = [...byState.entries()]
    .sort()
    .map(([state, count]) => `${state} ${count}`)
    .join(", ");
  console.log(`lint:proposals — ${proposals.length} propuestas, sin drift (${summary})`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
