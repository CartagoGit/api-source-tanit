/**
 * El gate de workflows: el YAML de `.github/workflows` tiene que parsear.
 *
 * ## Por qué esto tiene test
 *
 * Porque el fallo que vigila es **invisible por naturaleza**. Un
 * workflow con el YAML roto no pone en rojo ningún check: GitHub lo
 * ejecuta con el nombre del fichero, pierde sus filtros de disparador
 * y muere en cada push. El `ci-summary` —que es el check que
 * bloquea— sigue verde.
 *
 * El test comprueba las dos mitades: que el gate **falla** ante un
 * workflow roto (si no, el gate no vigila nada) y que **pasa** con los
 * workflows del repo (si no, el gate es ruido).
 *
 * El gate es un script de Bun porque necesita `Bun.YAML`. Los tests
 * corren bajo Node, así que lo invocan como proceso —que es
 * exactamente como lo invoca la CI.
 */
import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";

const execFileAsync = promisify(execFile);

const GATE = join(REPO_ROOT, "scripts", "gates", "lint-workflows.script.ts");

interface IRunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runGate(directory?: string): Promise<IRunResult> {
  const args = [GATE];
  if (directory !== undefined) {
    args.push(`--dir=${directory}`);
  }
  try {
    const { stdout, stderr } = await execFileAsync("bun", args, { cwd: REPO_ROOT });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("el gate de los workflows", () => {
  test("los workflows del repo son YAML válido", async () => {
    const result = await runGate();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("lint:workflows");
  });

  test("falla ante un workflow con el YAML roto", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tanit-workflows-"));
    // El cuerpo de un `run:` con la continuación sin indentar: YAML lo
    // lee como claves nuevas. Es exactamente el fallo que pasó.
    await writeFile(
      join(directory, "roto.yml"),
      [
        "name: roto",
        "",
        "on:",
        "  push:",
        "    branches: [main]",
        "",
        "jobs:",
        "  hola:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: |",
        "        echo \"hola",
        "sin sangrar",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runGate(directory);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("roto.yml");
    expect(result.stderr).toContain("YAML inválido");
  });

  test("falla ante un workflow sin nombre, sin disparador o sin jobs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tanit-workflows-"));
    await writeFile(join(directory, "sin-nombre.yml"), "on:\n  push:\njobs:\n  hola:\n    runs-on: ubuntu-latest\n", "utf8");
    await writeFile(join(directory, "sin-jobs.yml"), "name: sin jobs\non:\n  push:\n", "utf8");
    await writeFile(join(directory, "sin-on.yml"), "name: sin disparador\njobs:\n  hola:\n    runs-on: ubuntu-latest\n", "utf8");

    const result = await runGate(directory);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("sin-nombre.yml");
    expect(result.stderr).toContain("sin-jobs.yml");
    expect(result.stderr).toContain("sin-on.yml");
  });

  test("acepta el disparador con la clave booleana `on`", async () => {
    // `on:` sin comillas es la clave `true` en YAML. Un gate que
    // fallara por eso sería un gate que estorba.
    const directory = await mkdtemp(join(tmpdir(), "tanit-workflows-"));
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "bien.yml"),
      "name: bien\non:\n  push:\n    branches: [main]\njobs:\n  hola:\n    runs-on: ubuntu-latest\n",
      "utf8",
    );

    const result = await runGate(directory);
    expect(result.code).toBe(0);
  });
});
