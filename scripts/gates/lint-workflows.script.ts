#!/usr/bin/env bun
/**
 * `bun run lint:workflows` — comprueba que los workflows de GitHub
 * Actions son YAML válido y tienen lo mínimo para existir.
 *
 * Por qué existe
 * ──────────────
 * Porque un workflow con el YAML roto **no falla donde se ve**.
 *
 * GitHub lo ejecuta con el **nombre del fichero** en vez del suyo,
 * pierde los filtros de disparador —se pone a correr en cada push de
 * cada rama— y muere con un error de sintaxis en un log que nadie
 * mira. El check que importa (`ci-summary`) sigue verde: el workflow
 * que debía hacer un trabajo se limita a no hacerlo, y nada en el
 * repositorio dice que eso esté pasando.
 *
 * Pasó con `rehydrate-develop.yml`: el cuerpo del pull request iba en
 * un argumento con comillas y su continuación **no** estaba indentada,
 * así que YAML la leía como claves nuevas. El workflow se ejecutó en
 * cada push de cada rama y nunca rehidrató nada. El gate que ya
 * vigilaba el `ci-summary` no lo veía, porque el `ci-summary` era
 * verde: el workflow roto no participaba en él.
 *
 * Qué comprueba
 * ─────────────
 * - El YAML **parsea**. Un error de sintaxis es un problema, no un
 *   detalle: el fichero entero deja de ser un workflow.
 * - Tiene `name`. Sin él, GitHub muestra el nombre del fichero y el
 *   workflow pasa desapercibido.
 * - Tiene `on:` (el disparador). Sin él no se dispara por nada.
 * - Tiene `jobs`. Sin él no hace nada.
 *
 * Uso
 * ───
 *   bun run lint:workflows
 *   bun run lint:workflows --dir=<otro-directorio>
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface IParsedWorkflow {
  readonly name?: unknown;
  readonly on?: unknown;
  readonly jobs?: unknown;
  /**
   * El disparador, cuando el YAML lo escribió como `on:` sin
   * comillas. En YAML la clave `on` es el booleano `true` —en 1.1 y
   * en 1.2, por compatibilidad—, así que el parser entrega la
   * clave `true` y no la clave `on`.
   */
  readonly ["true"]?: unknown;
}

/**
 * El disparador del workflow.
 *
 * `on:` sin comillas es la clave booleana `true` en YAML, así que un
 * workflow bien escrito puede llevar su disparador en `on` **o** en
 * `true`. Los dos son lo mismo, y el gate no puede fallar por una
 * diferencia de sintaxis que no cambia el significado.
 */
function triggerOf(parsed: IParsedWorkflow): unknown {
  return parsed.on ?? parsed["true"];
}

export async function checkWorkflows(
  directory: string,
): Promise<ReadonlyArray<string>> {
  const problems: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [`el directorio ${directory} no existe o no se puede leer`];
  }

  const workflows = entries
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();

  for (const file of workflows) {
    const raw = await readFile(join(directory, file), "utf8");

    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(raw);
    } catch (error) {
      problems.push(`${file}: YAML inválido — ${(error as Error).message}`);
      continue;
    }

    if (parsed === null || typeof parsed !== "object") {
      problems.push(`${file}: el YAML no describe un mapa`);
      continue;
    }

    const workflow = parsed as IParsedWorkflow;

    if (typeof workflow.name !== "string" || workflow.name.trim().length === 0) {
      problems.push(
        `${file}: sin "name" — GitHub mostraría el nombre del fichero y el workflow pasaría desapercibido`,
      );
    }

    if (triggerOf(workflow) === undefined || triggerOf(workflow) === null) {
      problems.push(`${file}: sin "on:" — no se dispara por nada`);
    }

    if (workflow.jobs === undefined || workflow.jobs === null) {
      problems.push(`${file}: sin "jobs" — no hace nada`);
    }
  }

  return problems;
}

export async function main(): Promise<number> {
  const dirArgument = process.argv.find((argument) => argument.startsWith("--dir="));
  const directory = dirArgument
    ? resolve(ROOT, dirArgument.slice("--dir=".length))
    : join(ROOT, ".github", "workflows");

  const problems = await checkWorkflows(directory);

  if (problems.length > 0) {
    console.error(`lint:workflows — ${problems.length} problema(s):\n`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error(
      "\n  Un workflow con el YAML roto no se ve: GitHub lo ejecuta con\n" +
        "  el nombre del fichero, pierde sus filtros y muere en cada push\n" +
        "  sin que ningún check se ponga rojo. Arregla el YAML antes de\n" +
        "  subirlo.",
    );
    return 1;
  }

  console.log("lint:workflows — todos los workflows son YAML válido y tienen name, on y jobs.");
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
