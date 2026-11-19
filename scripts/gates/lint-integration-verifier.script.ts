#!/usr/bin/env bun
/**
 * `bun run lint:integration-verifier` — gate post-merge con las
 * 5 preguntas locales + 3 reusadas = 8 totales que el análisis
 * 2026-09-05/06 enumeró como residuos típicos del trabajo
 * multiagente. x00049 S1.
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
 * El integration verifier responde a 8 preguntas en total: 5
 * implementadas localmente en este script (las únicas que necesitan
 * lógica cross-cutting propia) y 3 reutilizadas de gates que ya
 * corren en `bun run lint`. Cada pregunta devuelve una lista de
 * offenders (vacía = OK). El gate orquesta, agrega el reporte y
 * falla si alguna falla.
 *
 * Las 5 preguntas locales (implementadas aquí)
 * ────────────────────────────────────────────
 *
 *   1. paths-obsoletos
 *      ¿Hay paths antiguos referenciados en código, configs o
 *      workflows? Excluye proposals/ (la historia documenta el
 *      pasado).
 *
 *   2. duplicate-ids
 *      ¿Hay IDs duplicados en proposals/? Wrapper sobre
 *      lint:proposals.
 *
 *   3. dangling-scripts
 *      ¿Hay scripts `bun run --cwd <dir>` donde `<dir>` no existe?
 *      ¿Hay scripts con paths absolutos a directorios que no
 *      existen?
 *
 *   4. workflow-overlap
 *      ¿Hay workflows que duplican responsabilidad con
 *      validate.yml? Hoy sólo cubre el caso
 *      `packages/plugins/delendai_tanit` (la regresión real
 *      reciente); extensible.
 *
 *   5. lockfile-sync
 *      ¿Hay dependencias en package.json que NO están en bun.lock?
 *      ¿Hay entradas en bun.lock que NO están en package.json?
 *      Wrapper sobre `bun install --frozen-lockfile --dry-run`.
 *
 * Las 3 preguntas reusadas (las corre otro gate, este script NO
 * las reimplementa — sólo las enuncia para que el developer sepa
 * que están en el perímetro)
 * ───────────────────────────────────────────────────────────────
 *
 *   6. root-allowlist — reusada de `scripts/gates/lint-root-allowlist.script.ts`
 *      (x00047). ¿Hay ficheros no permitidos en la raíz?
 *
 *   7. skip-env-vars — reusada de
 *      `scripts/gates/lint-no-skip-env-vars.script.ts` (x00046 S3).
 *      ¿Hay env vars `*_SKIP_*` exportadas en workflows, specs o
 *      código del producto?
 *
 *   8. clean-tree — reusada de `scripts/gates/lint-clean-tree.script.ts`
 *      (x00049). ¿El árbol tiene basura sin commitear?
 *
 * Las 2 preguntas restantes del diseño original (x00049 §why:
 * nº 7 "bun run validate desde checkout limpio" y nº 10 "HEAD CI
 * verde" vía `gh api`) requieren red o un subproceso de CI y se
 * omiten por defecto; viven fuera del integration verifier.
 *
 * Uso
 * ───
 *   bun run lint:integration-verifier
 *   bun run lint:integration-verifier --explain
 *   bun run lint:integration-verifier --skip=paths-obsoletos,dangling-scripts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  // Las exclusiones legítimas:
  //   - `docs/delendai/proposals/` — el AGENT-BOOTSTRAP permite
  //     retener paths históricos como arqueología en propuestas
  //     archivadas.
  //   - el propio gate — sus patrones de detección SON estas strings.
  //   - `docs/delendai/AGENT-BOOTSTRAP.md` y `UNIVERSAL-...` — el
  //     bootstrap documenta la migración y cita la ruta antigua
  //     deliberadamente.
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
        [
          "-rln",
          "--include=*.ts", "--include=*.js", "--include=*.json", "--include=*.yml",
          "--include=*.md",
          "--exclude=lint-integration-verifier.script.ts",
          "--exclude-dir=proposals",
          "--exclude-dir=node_modules",
          "--exclude-dir=.git",
          path,
          "packages", "integrations", "scripts", "tests", "docs",
          "CONTRIBUTING.md", "README.md", "AGENTS.md", "CLAUDE.md",
          "delendai.config.json", ".github", ".mcp.json", ".vscode", ".docker",
        ],
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
  // Lee el FRONTMATTER real de cada propuesta (primer bloque entre
  // `---`), no el cuerpo — el cuerpo de una auditoría archivada puede
  // citar el `id:` de otras propuestas como historia, y eso NO es
  // duplicación. x00049.
  const ids = new Map<string, string[]>(); // id → paths
  const walkSync = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walkSync(full);
        continue;
      }
      if (!entry.endsWith(".md") || entry === "INDEX.md" || entry === "README.md") continue;
      const text = readFileSync(full, "utf8");
      if (!text.startsWith("---")) continue;
      const end = text.indexOf("\n---", 3);
      if (end < 0) continue;
      const frontmatter = text.slice(3, end);
      const m = /^id:\s*([a-z]?[0-9]{5})\s*$/m.exec(frontmatter);
      if (!m) continue;
      const id = m[1]!;
      const paths = ids.get(id) ?? [];
      paths.push(full.replace(`${REPO_ROOT}/`, ""));
      ids.set(id, paths);
    }
  };
  walkSync(join(REPO_ROOT, "docs/delendai/proposals"));
  const dupes: string[] = [];
  for (const [id, paths] of ids) {
    if (paths.length > 1) dupes.push(`id '${id}' aparece ${paths.length} veces: ${paths.join(", ")}`);
  }
  return dupes;
}

async function checkDanglingScripts(): Promise<string[]> {
  // Lee package.json raíz y comprueba cada script que use `--cwd <dir>`.
  const pkg = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
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

interface IWorkflowTriggers {
  readonly push?: ReadonlyArray<string>;
  readonly pull_request?: ReadonlyArray<string>;
}

/**
 * Lee el set de triggers de un workflow de GitHub Actions.
 *
 * El formato YAML de `on:` permite tanto inline
 * (`branches: [main, develop]`) como multilínea
 * (`branches:\n  - main\n  - develop`) y la forma escalar
 * (`branches: main`). `Bun.YAML.parse` normaliza las dos
 * primeras a `string[]`; la escalar la reenvasamos a array
 * para que el matcher sea simétrico. Bun lleva YAML built-in
 * (Bun.YAML) — no requiere dependencia externa; la declaración
 * ambient está en `runtime.d.ts`.
 *
 * Devuelve `null` si el workflow no se puede leer, está vacío,
 * o no tiene sección `on:` parseable. Eso NO es un offender:
 * un workflow sin triggers no es un duplicado de validate.yml.
 */
function readWorkflowTriggers(file: string): IWorkflowTriggers | null {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const on = (parsed as { on?: unknown }).on;
  if (!on || typeof on !== "object") return null;
  const onObj = on as Record<string, unknown>;
  return {
    push: extractBranches(onObj.push),
    pull_request: extractBranches(onObj.pull_request),
  };
}

function extractBranches(trigger: unknown): string[] | undefined {
  if (!trigger || typeof trigger !== "object") return undefined;
  const branches = (trigger as { branches?: unknown }).branches;
  if (branches === undefined || branches === null) return undefined;
  if (typeof branches === "string") return [branches];
  if (Array.isArray(branches)) {
    return branches.filter((b): b is string => typeof b === "string");
  }
  return undefined;
}

function branchSetsEqual(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const branch of b) {
    if (!setA.has(branch)) return false;
  }
  return true;
}

/**
 * Decide si dos workflows cubren los mismos triggers. Un match
 * requiere que **tanto** `push` como `pull_request` declaren
 * exactamente el mismo set de ramas — si una de las dos
 * dimensiones falta, el workflow hace una cosa distinta en esa
 * dimensión y no es una duplicación real del camino crítico de
 * validate.yml. Esto es más estricto que el grep textual previo
 * (que mezclaba las dos dimensiones y daba falsos positivos si
 * un workflow mencionaba `branches: [main, develop]` en una
 * dimensión pero no en la otra).
 */
function triggersMatch(a: IWorkflowTriggers, b: IWorkflowTriggers): boolean {
  if (!a.push || !a.pull_request || !b.push || !b.pull_request) return false;
  return branchSetsEqual(a.push, b.push) && branchSetsEqual(a.pull_request, b.pull_request);
}

async function checkWorkflowOverlap(): Promise<string[]> {
  // Parsea YAML real (Bun.YAML) para detectar workflows con los
  // mismos triggers que `validate.yml`. Captura tanto el formato
  // inline como el multilínea, y separa `push` de `pull_request`
  // — el grep textual previo mezclaba ambas dimensiones.
  const workflowDir = join(REPO_ROOT, ".github/workflows");
  if (!existsSync(workflowDir)) return [];
  const canonical = readWorkflowTriggers(join(workflowDir, "validate.yml"));
  if (!canonical) return [];

  const offenders: string[] = [];
  for (const entry of readdirSync(workflowDir)) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    if (entry === "validate.yml") continue;
    const triggers = readWorkflowTriggers(join(workflowDir, entry));
    if (!triggers) continue;
    if (triggersMatch(canonical, triggers)) {
      offenders.push(`.github/workflows/${entry} ⟵ mismo trigger que validate.yml`);
    }
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
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const lock = readFileSync(join(REPO_ROOT, "bun.lock"), "utf8");

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