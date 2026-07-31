/**
 * Helpers puros para ejecutar cada step del tool `postman_exporter_test`.
 *
 * Cada función devuelve un `IStepResult` con su `ok` calculado a partir
 * del exit code + un `detail` legible. Sin estado global. Una sola
 * responsabilidad por función.
 */

import { spawnSync } from "node:child_process";

import type { IStepResult, StepName } from "../contract/postman-exporter-testing.interface";

interface IRunStepOptions {
  readonly cwd: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly timeoutMs: number;
  /** Mapeo opcional de exit-code → mensaje humano (default: "ok" / "fail"). */
  readonly detailFor?: (
    stdout: string,
    stderr: string,
    exitCode: number,
  ) => string;
}

function runStep({
  cwd,
  command,
  args,
  timeoutMs,
  detailFor,
}: IRunStepOptions): Omit<IStepResult, "name"> {
  const start = Date.now();
  const r = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  const exitCode = r.status ?? (r.error ? 1 : 0);
  const ok = exitCode === 0;
  const detail =
    detailFor?.(stdout, stderr, exitCode) ??
    (ok ? "passed" : `exit ${exitCode}`);
  return {
    ok,
    exitCode,
    durationMs: Date.now() - start,
    detail: detail.trim(),
  };
}

// --- Steps específicos ------------------------------------------------------

export function runTypecheck(cwd: string, timeoutMs: number): Omit<IStepResult, "name"> {
  return runStep({
    cwd,
    command: "bunx",
    args: ["tsc", "--noEmit"],
    timeoutMs,
    detailFor: (stdout, stderr, code) =>
      code === 0 ? "tsc --noEmit OK" : (stderr.trim().split("\n")[0] ?? `exit ${code}`),
  });
}

export function runBuild(cwd: string, timeoutMs: number): Omit<IStepResult, "name"> {
  return runStep({
    cwd,
    command: "bun",
    args: ["run", "scripts/generate.script.ts"],
    timeoutMs,
    detailFor: (stdout, _stderr, code) => {
      if (code !== 0) return `exit ${code}`;
      const m = stdout.match(/(\d+)\s+requests en\s+(\d+)\s+carpetas/);
      return m ? `${m[1]} requests, ${m[2]} carpetas` : "build OK";
    },
  });
}

export function runCheck(cwd: string, timeoutMs: number): Omit<IStepResult, "name"> {
  // check = diff.script.ts (cobertura) + validate-json.script.ts (schema).
  // Como Bun.script no soporta `&&`, encadenamos manualmente.
  const diff = runStep({
    cwd,
    command: "bun",
    args: ["run", "scripts/diff.script.ts"],
    timeoutMs: Math.floor(timeoutMs / 2),
    detailFor: (stdout, _stderr, code) => {
      if (code !== 0) return `diff exit ${code}`;
      const m = stdout.match(/Routes en source:\s+(\d+)/);
      return m ? `${m[1]} rutas en código` : "diff OK";
    },
  });
  if (!diff.ok) {
    return { ...diff, detail: `diff failed: ${diff.detail}` };
  }
  const schema = runStep({
    cwd,
    command: "bun",
    args: ["run", "scripts/validate-json.script.ts"],
    timeoutMs: Math.floor(timeoutMs / 2),
    detailFor: (stdout, _stderr, code) =>
      code === 0 ? "schema v2.1.0 OK" : `schema exit ${code}`,
  });
  return {
    ok: schema.ok,
    exitCode: schema.exitCode,
    durationMs: diff.durationMs + schema.durationMs,
    detail: schema.ok ? `${diff.detail}; ${schema.detail}` : schema.detail,
  };
}

/** Resuelve qué steps correr según el `step` pedido. */
export function stepsFor(step: StepName): ReadonlyArray<StepName> {
  if (step === "all") return ["typecheck", "build", "check"];
  return [step];
}
