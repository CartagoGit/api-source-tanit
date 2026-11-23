#!/usr/bin/env bun
/**
 * `bun run lint:no-skip-env-vars` — rechaza variables de entorno
 * `*_SKIP_*` exportadas desde workflows del producto.
 * x00046 S3.
 *
 * Por qué existe
 * ──────────────
 * El bug que cerró x00046 era el flag
 * `TANIT_SKIP_MULTI_SERVICE_ISOLATION=1` exportado desde
 * `.github/workflows/validate.yml`. La práctica correcta es: si
 * una e2e falla en CI, se arregla el test o el código, no se
 * enmascara con una variable de entorno. La variable
 * `TANIT_SKIP_*` es el olor.
 *
 * La fix x00045 (quitar Delendai de la CI principal) eliminó la
 * causa original que motivó la introducción del flag; este gate
 * garantiza que la práctica no vuelve.
 *
 * Qué considera violación
 * ───────────────────────
 * - En `.github/workflows/validate.yml`, **no** debe aparecer
 *   ninguna entrada `env:` con clave que case con `*_SKIP_*`
 *   (con guión bajo final antes del `=`) en `run:` directo de steps.
 *   Sólo se inspecciona el `env:` de steps, no el `env:` global del
 *   job (que es donde se declaran dependencias no-SKIP).
 *
 * - En el spec `tests/e2e/multi-service-isolation.spec.ts`, no debe
 *   quedar referencia a `TANIT_SKIP_MULTI_SERVICE_ISOLATION` (el spec
 *   ya no debe auto-skiparse por env vars).
 *
 * - En código fuente (`packages/`, `integrations/`, `tests/`), no debe
 *   haber `process.env.TANIT_SKIP_*` como guard de skip. Otros usos
 *   legítimos de `process.env.TANIT_*` (p.ej. `TANIT_ALLOW_DIRTY`)
 *   no se tocan.
 *
 * Excepciones
 * ───────────
 * - `TANIT_ALLOW_DIRTY=1` está documentado en `lint-clean-tree.script.ts`
 *   y es legítimo — desactiva un gate temporal de desarrollo. No es
 *   un *_SKIP_* y no entra aquí.
 *
 * Uso
 * ───
 *   bun run lint:no-skip-env-vars
 *
 * Salida
 * ──────
 * - 0 si no hay infracciones.
 * - 1 con la lista exacta de offenders si los hay.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { REPO_ROOT } from "../helpers/root.helper.js";

const execFileAsync = promisify(execFile);

interface IOffender {
  readonly source: string;
  readonly line: number;
  readonly text: string;
}

/** Patrón: `clave` en `env:` de un step de GitHub Actions. */
const STEP_ENV = /^\s{6,}([A-Z][A-Z0-9_]*)\s*:\s*"?\$?\{"?[A-Z][A-Z0-9_]*"?\}?"?\s*$/;

/** Patrón: `_SKIP_` en identificador (case-insensitive). */
const SKIP_NAME = /_SKIP_/;

/** Patrón: `process.env.TANIT_SKIP_*` usado como guard. */
const PROCESS_ENV_SKIP = /process\.env\.TANIT_SKIP_[A-Z_]+/;

async function readWorkflow(): Promise<string> {
  const path = `${REPO_ROOT}/.github/workflows/validate.yml`;
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8");
}

async function readSpec(): Promise<string> {
  const path = `${REPO_ROOT}/tests/e2e/multi-service-isolation.spec.ts`;
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function findStepEnvSkipFlags(workflow: string): IOffender[] {
  const offenders: IOffender[] = [];
  const lines = workflow.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = STEP_ENV.exec(line);
    if (!m) continue;
    const name = m[1]!;
    if (SKIP_NAME.test(name)) {
      offenders.push({ source: "validate.yml", line: i + 1, text: line.trim() });
    }
  }
  return offenders;
}

function findSpecSkipFlags(spec: string): IOffender[] {
  const offenders: IOffender[] = [];
  const lines = spec.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // El comentario histórico sobre `TANIT_SKIP_MULTI_SERVICE_ISOLATION`
    // está permitido (documenta la regresión); cualquier uso real
    // (skipIf, env.X === "1", process.env.X) NO.
    if (line.trim().startsWith("*") || line.trim().startsWith("//")) continue;
    if (PROCESS_ENV_SKIP.test(line) || /skipIf\(process\.env\.TANIT_SKIP_/.test(line)) {
      offenders.push({ source: "multi-service-isolation.spec.ts", line: i + 1, text: line.trim() });
    }
  }
  return offenders;
}

async function findCodeSkipFlags(): Promise<IOffender[]> {
  const offenders: IOffender[] = [];
  try {
    // Sólo código fuente propio, no node_modules ni .cache.
    const { stdout } = await execFileAsync(
      "grep",
      [
        "-rnE",
        "process\\.env\\.TANIT_SKIP_[A-Z_]+",
        "--include=*.ts",
        "--include=*.tsx",
        "--include=*.js",
        "packages",
        "integrations",
        "tests",
      ],
      { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 },
    );
    for (const raw of stdout.trim().split("\n")) {
      if (!raw) continue;
      const m = /^(.+):(\d+):(.*)$/.exec(raw);
      if (!m) continue;
      const file = m[1]!;
      const line = Number(m[2]!);
      const text = m[3]!.trim();
      offenders.push({ source: file, line, text });
    }
  } catch (err) {
    // grep exit 1 → no hay matches, está bien.
    if ((err as { code?: number }).code !== 1) {
      throw err;
    }
  }
  return offenders;
}

export async function main(): Promise<number> {
  const workflow = await readWorkflow();
  const spec = await readSpec();
  const code = await findCodeSkipFlags();

  const workflowOffenders = findStepEnvSkipFlags(workflow);
  const specOffenders = findSpecSkipFlags(spec);
  const all = [...workflowOffenders, ...specOffenders, ...code];

  if (all.length === 0) {
    console.log("lint:no-skip-env-vars -- 0 infracciones (sin *_SKIP_* en workflows, specs ni código del producto)");
    return 0;
  }

  console.error("lint:no-skip-env-vars --", all.length, "infracción(es):");
  for (const o of all) {
    console.error(`  ${o.source}:${o.line}  ${o.text}`);
  }
  console.error("");
  console.error("Las variables *_SKIP_* en workflows/tests enmascaran fallos");
  console.error("reales en CI. Arregla el test o el código subyacente; no");
  console.error("añadas una variable de entorno para silenciar.");
  return 1;
}

if (import.meta.main) {
  const code_ = await main();
  process.exit(code_);
}