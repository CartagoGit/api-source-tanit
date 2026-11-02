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

/**
 * Los scripts `run:` del workflow.
 *
 * Un workflow puede tener los scripts dondequiera: en un job, en un
 * paso, dentro de un `if`. Se recogen todos.
 */
function runScripts(node: unknown, into: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      runScripts(item, into);
    }
    return into;
  }
  if (node === null || typeof node !== "object") {
    return into;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "run" && typeof value === "string") {
      into.push(value);
      continue;
    }
    runScripts(value, into);
  }
  return into;
}

/**
 * Los heredocs cuyo terminador no está en la columna 0.
 *
 * En YAML, la sangría base de un escalar de bloque se saca de su
 * **primera** línea no vacía. Si esa línea está menos indentada que
 * las demás, el parser les deja a todas las otras su sangría extra, y
 * el script que ve bash no es el que el fichero dice.
 *
 * En un heredoc eso rompe el terminador: bash lo exige en la columna
 * 0, y con dos espacios de más no lo reconoce —"here-document
 * delimited by end-of-file"—, el heredoc se come el resto del script
 * y el paso muere.
 *
 * El YAML **sí** es válido: un parser no ve el problema. Por eso hay
 * que mirar el script que sale, no el fichero.
 *
 * No todo `<<` es un heredoc: `echo "files<<EOF"` es un valor
 * multilínea de `GITHUB_OUTPUT`, y su terminador es `echo "EOF"`. Un
 * `<<` dentro de una cadena no cuenta.
 */
export function heredocProblems(script: string): ReadonlyArray<string> {
  const problems: string[] = [];
  const lineas = script.split("\n");
  const delimiters = new Map<string, boolean>();

  for (const linea of lineas) {
    const match = linea.match(/<<(-?)\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
    if (match?.[2] === undefined) {
      continue;
    }
    const indice = linea.indexOf("<<");
    const comillasAntes = (linea.slice(0, indice).match(/["']/g) ?? []).length;
    if (comillasAntes % 2 === 1) {
      // El `<<` está dentro de una cadena: no es un heredoc.
      continue;
    }
    // `<<-` admite un terminador indentado con tabuladores.
    delimiters.set(match[2], match[1] === "-");
  }

  for (const [delimiter, conTabs] of delimiters) {
    const encontrado = conTabs
      ? lineas.some((linea) => linea.replace(/^\t+/, "") === delimiter)
      : lineas.some((linea) => linea === delimiter);
    if (!encontrado) {
      problems.push(
        `el terminador del heredoc "${delimiter}" no está en la columna 0: bash no lo reconoce`,
      );
    }
  }

  return problems;
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

    // El script que bash va a ver, no el del fichero: el YAML puede
    // ser válido y el script estar roto.
    for (const script of runScripts(workflow.jobs)) {
      for (const problem of heredocProblems(script)) {
        problems.push(`${file}: ${problem}`);
      }
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
