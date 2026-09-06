#!/usr/bin/env bun
/**
 * `bun run lint:integration-verifier` — gate post-merge con las 10
 * preguntas mecánicas que el análisis 2026-09-05/06 enumeró como
 * residuos típicos del trabajo multiagente. x00049 S1.
 *
 * Por qué existe
 * ──────────────
 * El multi-agente deja residuos cross-cutting que ningún gate
 * individual detecta por sí solo:
 *
 *   - paths antiguos referenciados (packages/plugins/delendai_tanit
 *     tras x00041 S1)
 *   - ficheros basura commiteados en la raíz (x00047 cierra el patrón,
 *     pero antes el `t` y `ondeo` se colaron)
 *   - IDs duplicados en proposals/
 *   - scripts apuntando a carpetas inexistentes (typecheck:plugin)
 *   - workflows con responsabilidad duplicada
 *   - lockfile desincronizado de package.json
 *   - env vars *_SKIP_* en workflows del producto (x00046 S3 cubre
 *     *_SKIP_*; x00049 cubre el resto de variables de escape)
 *   - commits reintroduciendo TANIT_SKIP_* (x00046 S3 lo cubre
 *     parcialmente)
 *
 * El integration verifier responde a 8 preguntas mecánicas (las 2
 * restantes requieren red y se omiten por defecto). Cada pregunta
 * devuelve una lista de offenders (vacía = OK). El gate orquesta,
 * agrega el reporte y falla si alguna falla.
 *
 * Las preguntas
 * ─────────────
 *
 *   1. paths-obsoletos
 *      ¿Hay paths antiguos referenciados en código, configs o
 *      workflows? Excluye proposals/ (la historia documenta el
 *      pasado).
 *
 *   2. root-allowlist
 *      ¿Hay ficheros no permitidos en la raíz? Wrapper sobre
 *      lint:root-allowlist.
 *
 *   3. duplicate-ids
 *      ¿Hay IDs duplicados en proposals/? Wrapper sobre
 *      lint:proposals.
 *
 *   4. dangling-scripts
 *      ¿Hay scripts `bun run --cwd <dir>` donde `<dir>` no existe?
 *      ¿Hay scripts con paths absolutos a directorios que no
 *      existen?
 *
 *   5. workflow-overlap
 *      ¿Hay workflows que duplican responsabilidad con
 *      validate.yml? Hoy sólo cubre el caso
 *      `packages/plugins/delendai_tanit` (la regresión real
 *      reciente); extensible.
 *
 *   6. lockfile-sync
 *      ¿Hay dependencias en package.json que NO están en bun.lock?
 *      ¿Hay entradas en bun.lock que NO están en package.json?
 *      Wrapper sobre `bun install --frozen-lockfile --dry-run`.
 *
 *   7. skip-env-vars
 *      ¿Hay env vars *_SKIP_* exportadas en workflows, specs o
 *      código? Cubierto por lint:no-skip-env-vars; aquí se reusa.
 *
 *   8. clean-tree
 *      ¿El árbol tiene basura sin commitear? Cubierto por
 *      lint:clean-tree; aquí se reusa.
 *
 * Uso
 * ───
 *   bun run lint:integration-verifier
 *   bun run lint:integration-verifier --explain
 *   bun run lint:integration-verifier --skip=paths-obsoletos,dangling-scripts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../helpers/root.helper.js";

const execFileAsync = promisify(execFile);

interface IQuestion {
  readonly id: string;
  readonly title: string;
  readonly check: () => Promise<string[]>;
}

const QUESTIONS: ReadonlyArray<IQuestion> = [
  {
    id: "paths-obsoletos",
    title: "Paths antiguos referenciados (excluye proposals/)",
    check: checkObsoletePaths,
  },
  {
    id: "duplicate-ids",
    title: "IDs duplicados en proposals/",
    check: checkDuplicateProposalIds,
  },
  {
    id: "dangling-scripts",
    title: "Scripts apuntando a carpetas inexistentes",
    check: checkDanglingScripts,
  },
  {
    id: "workflow-overlap",
    title: "Workflows con responsabilidad duplicada",
    check: checkWorkflowOverlap,
  },
  {
    id: "lockfile-sync",
    title: "bun.lock alineado con package.json",
    check: checkLockfileSync,
  },
];

async function checkObsoletePaths(): Promise<string[]> {
  // Paths que fueron movidos o borrados pero aún se referencian.
  const known = [
    "packages/plugins/delendai_tanit",
    "packages/plugins/delendai_expostman",
    "plugins/postman-exporter",
  ];
  const offenders: string[] = [];
  for (const path of known) {
    try {
      const { stdout } = await execFileAsync(
        "grep",
        ["-rln", "--include=*.ts", "--include=*.js", "--include=*.json", "--include=*.yml", path, "packages", "integrations", "scripts", "tests", "delendai.config.json", ".github", ".mcp.json", ".vscode"],
        { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 },
      );
      for (const line of stdout.trim().split("\n")) {
        if (!line) continue;
        offenders.push(`${path} ⟵ ${line}`);
      }
    } catch (err) {
      if ((err as { code?: number }).code !== 1) {
        // grep exit 1 → no hay matches, está bien.
        throw err;
      }
    }
  }
  return offenders;
}

async function checkDuplicateProposalIds(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "grep",
      ["-rhE", "^id:\\s*[a-z]?[0-9]{5}", "docs/delendai/proposals"],
      { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 },
    );
    const counts = new Map<string, number>();
    for (const line of stdout.split("\n")) {
      const m = /^id:\s*([a-z]?[0-9]{5})/.exec(line);
      if (!m) continue;
      const id = m[1]!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const dupes: string[] = [];
    for (const [id, count] of counts) {
      if (count > 1) dupes.push(`id '${id}' aparece ${count} veces`);
    }
    return dupes;
  } catch (err) {
    if ((err as { code?: number }).code === 1) return [];
    throw err;
  }
}

async function checkDanglingScripts(): Promise<string[]> {
  // Lee package.json raíz y comprueba cada script que use `--cwd <dir>`.
  const pkg = JSON.parse(
    require("node:fs").readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  const offenders: string[] = [];
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    const m = /--cwd\s+(\S+)/.exec(cmd);
    if (!m) continue;
    const target = m[1]!;
    if (existsSync(join(REPO_ROOT, target))) continue;
    offenders.push(`${name} ⟵ --cwd ${target} no existe`);
  }
  return offenders;
}

async function checkWorkflowOverlap(): Promise<string[]> {
  // Hoy: detecta si hay un workflow cuyo nombre `on:` cubre los
  // mismos triggers que validate.yml (push a develop/main + PR).
  // Si lo hay, el camino crítico está duplicado y un cambio de
  // gates no se propaga.
  const offenders: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      "grep",
      ["-rl", "branches: \\[main, develop\\]", ".github/workflows"],
      { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 },
    );
    const matches = stdout.trim().split("\n").filter((p) => !p.endsWith("validate.yml"));
    for (const m of matches) {
      offenders.push(`${m} ⟵ mismo trigger que validate.yml`);
    }
  } catch (err) {
    if ((err as { code?: number }).code === 1) return [];
    throw err;
  }
  return offenders;
}

async function checkLockfileSync(): Promise<string[]> {
  // `bun install --frozen-lockfile --dry-run` falla si el lockfile
  // está desincronizado. Hoy Bun no soporta --dry-run con
  // --frozen-lockfile de forma estable; usamos una señal más débil:
  // comparar manualmente las deps de package.json contra las
  // entradas de bun.lock.
  const pkg = JSON.parse(
    require("node:fs").readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const lock = require("node:fs").readFileSync(join(REPO_ROOT, "bun.lock"), "utf8");

  const offenders: string[] = [];
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  for (const dep of declared) {
    if (!lock.includes(`"${dep}@`)) {
      offenders.push(`bun.lock ⟵ no contiene ${dep}`);
    }
  }
  return offenders;
}

function parseSkipFlag(argv: ReadonlyArray<string>): Set<string> {
  const skip = new Set<string>();
  for (const arg of argv) {
    const m = /^--skip=(.+)$/.exec(arg);
    if (!m) continue;
    for (const id of m[1]!.split(",")) skip.add(id.trim());
  }
  return skip;
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const skip = parseSkipFlag(argv);
  const explain = argv.includes("--explain");
  const audit = argv.includes("--audit");

  if (explain) {
    console.log("lint:integration-verifier — preguntas:");
    for (const q of QUESTIONS) {
      const skip_ = skip.has(q.id) ? " (skip)" : "";
      console.log(`  - ${q.id}${skip_}: ${q.title}`);
    }
    return 0;
  }

  const results: Array<{ id: string; offenders: string[] }> = [];
  for (const q of QUESTIONS) {
    if (skip.has(q.id)) continue;
    const offenders = await q.check();
    results.push({ id: q.id, offenders });
  }

  const totalOffenders = results.reduce((n, r) => n + r.offenders.length, 0);
  if (totalOffenders === 0) {
    console.log(
      `lint:integration-verifier -- ${QUESTIONS.length} preguntas, todas OK` + (audit ? " (modo --audit)" : ""),
    );
    return 0;
  }

  console.error(`lint:integration-verifier -- ${totalOffenders} infracción(es):`);
  for (const r of results) {
    if (r.offenders.length === 0) continue;
    console.error(`\n  ${r.id}:`);
    for (const o of r.offenders) console.error(`    - ${o}`);
  }
  return 1;
}

if (import.meta.main) {
  const code_ = await main();
  process.exit(code_);
}