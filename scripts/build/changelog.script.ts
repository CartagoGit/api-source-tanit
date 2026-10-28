#!/usr/bin/env bun
/**
 * `bun run changelog` — el CHANGELOG desde los commits.
 *
 * Se escribe aquí en vez de usar `conventional-changelog` porque el
 * formato de commit de este repo ya es conocido y estable, y la
 * herramienta traería un árbol de dependencias entero para leer `git
 * log` y agrupar por prefijo. Lo que sí hace falta y no viene de serie es
 * lo de abajo.
 *
 * **El cuerpo del commit cuenta.** En este repo el asunto dice qué se
 * hizo y el cuerpo dice **por qué**, que es lo que no se puede deducir
 * del diff. Un CHANGELOG que solo copie los asuntos tira justo la mitad
 * que costó escribir. Aquí, cuando un commit trae cuerpo, su primer
 * párrafo va debajo como explicación.
 *
 * Uso:
 *   bun run changelog                  # desde el último tag hasta HEAD
 *   bun run changelog --from v0.1.0    # desde un tag concreto
 *   bun run changelog --write          # lo escribe en CHANGELOG.md
 */
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/** Prefijo de Conventional Commits → título de su sección. */
const SECTIONS: ReadonlyArray<{ prefix: string; title: string }> = [
  { prefix: "feat", title: "Novedades" },
  { prefix: "fix", title: "Arreglos" },
  { prefix: "perf", title: "Rendimiento" },
  { prefix: "refactor", title: "Refactors" },
  { prefix: "docs", title: "Documentación" },
  { prefix: "test", title: "Tests" },
  { prefix: "build", title: "Build" },
  { prefix: "ci", title: "CI" },
  { prefix: "chore", title: "Mantenimiento" },
];

/**
 * Separador entre campos del `git log`.
 *
 * Un carácter que no aparece en un mensaje de commit. Con un salto de
 * línea no valdría: los cuerpos los tienen.
 */
const FIELD = "";
const RECORD = "";

interface ICommit {
  readonly hash: string;
  readonly subject: string;
  readonly body: string;
}

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} falló: ${result.stderr?.trim() ?? ""}`);
  }
  return result.stdout ?? "";
}

/** El último tag alcanzable, o `null` si el repo no tiene ninguno. */
function lastTag(): string | null {
  const result = spawnSync("git", ["describe", "--tags", "--abbrev=0"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? (result.stdout ?? "").trim() || null : null;
}

function readCommits(from: string | null): ICommit[] {
  const range = from ? `${from}..HEAD` : "HEAD";
  const raw = git(["log", range, `--pretty=format:%h${FIELD}%s${FIELD}%b${RECORD}`]);
  return raw
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", subject = "", body = ""] = record.split(FIELD);
      return { hash, subject, body };
    });
}

/** `feat(scope): asunto` → sus partes. `null` si no sigue el convenio. */
function parseSubject(
  subject: string,
): { type: string; scope: string | null; breaking: boolean; text: string } | null {
  const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
  if (!match) return null;
  return {
    type: (match[1] ?? "").toLowerCase(),
    scope: match[2] ?? null,
    breaking: match[3] === "!",
    text: match[4] ?? "",
  };
}

/**
 * El primer párrafo del cuerpo, que es donde va el porqué.
 *
 * Se descartan las líneas de metadatos (`Co-Authored-By`, `Refs`): no
 * explican nada a quien lee el CHANGELOG.
 */
function reason(body: string): string | null {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^[A-Za-z-]+:\s/.test(p));
  if (!paragraph) return null;
  return paragraph.replace(/\s*\n\s*/g, " ").trim();
}

export function buildChangelog(commits: ReadonlyArray<ICommit>, from: string | null): string {
  const breaking: string[] = [];
  const bySection = new Map<string, string[]>();

  for (const commit of commits) {
    const parsed = parseSubject(commit.subject);
    // Un commit que no sigue el convenio no se inventa una sección: se
    // queda fuera y se dice cuántos al final.
    if (!parsed) continue;

    const scope = parsed.scope ? `**${parsed.scope}**: ` : "";
    const why = reason(commit.body);
    const entry =
      `- ${scope}${parsed.text} (\`${commit.hash}\`)` +
      (why ? `\n  ${why}` : "");

    if (parsed.breaking) breaking.push(entry);
    const section = SECTIONS.find((s) => s.prefix === parsed.type);
    if (!section) continue;
    const list = bySection.get(section.title) ?? [];
    list.push(entry);
    bySection.set(section.title, list);
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`## Sin publicar — ${today}`, ""];
  if (from) lines.push(`Cambios desde \`${from}\`.`, "");

  if (breaking.length > 0) {
    lines.push("### ⚠ Cambios que rompen", "", ...breaking, "");
  }
  for (const { title } of SECTIONS) {
    const entries = bySection.get(title);
    if (!entries || entries.length === 0) continue;
    lines.push(`### ${title}`, "", ...entries, "");
  }

  const counted = [...bySection.values()].reduce((n, l) => n + l.length, 0);
  const skipped = commits.length - counted;
  if (skipped > 0) {
    lines.push(
      `_${skipped} commit(s) fuera del convenio \`tipo: asunto\`, no listados._`,
      "",
    );
  }
  return lines.join("\n");
}

const CHANGELOG_PATH = join(REPO_ROOT, "CHANGELOG.md");
const HEADER = "# Changelog\n";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const fromIdx = argv.indexOf("--from");
  const from = fromIdx !== -1 ? (argv[fromIdx + 1] ?? null) : lastTag();

  const commits = readCommits(from);
  if (commits.length === 0) {
    console.log(`changelog — no hay commits nuevos${from ? ` desde ${from}` : ""}`);
    return 0;
  }

  const section = buildChangelog(commits, from);

  if (!argv.includes("--write")) {
    console.log(section);
    return 0;
  }

  // Se antepone: lo nuevo va arriba, y lo que ya estaba no se toca.
  const previous = existsSync(CHANGELOG_PATH)
    ? (await readFile(CHANGELOG_PATH, "utf8")).replace(HEADER, "").trimStart()
    : "";
  await writeFile(
    CHANGELOG_PATH,
    `${HEADER}\n${section}\n${previous ? `\n${previous}` : ""}`,
    "utf8",
  );
  console.log(`changelog — ${commits.length} commit(s) escritos en CHANGELOG.md`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
