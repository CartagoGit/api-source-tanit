#!/usr/bin/env bun
/**
 * `bun run lint:bun-ci` — la CI debe usar Bun y el lockfile de forma
 * reproducible.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

export interface IBunCiProblem {
  readonly line: number;
  readonly detail: string;
}

const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");
const WORKFLOW_FILE = /\.ya?ml$/;
const SETUP_BUN = /uses:\s*oven-sh\/setup-bun@/;
const BUN_VERSION = /^\s*bun-version:\s*["']?([^"'#\s]+)["']?/;
const FIXED_BUN_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const RUN_STEP = /^(\s*)(?:-\s*)?run:\s*(.*)$/;
const WORKFLOW_STEP = /^\s*-\s+/;
const BUN_INSTALL_COMMAND = /(?:^|&&\s*|[;&|]\s*)bun\s+install\b/;

// ---------------------------------------------------------------------------
// La parte que faltaba: las herramientas que el repo invoca por su nombre.
// ---------------------------------------------------------------------------
const GATES_DIR = join(REPO_ROOT, "scripts", "gates");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");
const LOCKFILE_PATH = join(REPO_ROOT, "bun.lock");

/**
 * El paquete que provee cada binario que el repo invoca con `bunx`.
 *
 * `bunx <herramienta>` usa el binario local si lo encuentra; si no, **lo
 * baja del registro**. La segunda es la que rompe la reproducibilidad:
 * el lockfile deja de decidir qué se ejecuta, y el gate empieza a
 * depender del día. Con `typescript` sin declarar, `bunx tsc` bajó la
 * 7.0.2 y el typecheck falló con un `TS2321` que no era de los tipos —
 * el compilador era otro, no el del lockfile.
 *
 * El mapeo es explícito a propósito: una herramienta nueva que se
 * invoque con `bunx` tiene que aparecer aquí. El gate avisa cuando no
 * aparece, para que la decisión "esta herramienta la trae el paquete X"
 * quede escrita y no se adivine.
 */
const BINARY_TO_PACKAGE: Readonly<Record<string, string>> = {
  tsc: "typescript",
  vitest: "vitest",
};

/**
 * Paquetes cuya versión **define la respuesta** del gate que los usa.
 *
 * El compilador decide si los tipos cuadran. Con un rango (`^5.9.3`),
 * un `bun update` cambia el veredicto sin que cambie una línea del
 * repo: el typecheck deja de ser una propiedad del código y pasa a
 * ser una propiedad del día. Fijado, el veredicto es del código.
 */
const EXACT_VERSION_PACKAGES: ReadonlySet<string> = new Set(["typescript"]);

/** `spawnSync("bunx", ["tsc", ...])` y `run("bunx", ["vitest", ...])`. */
const BUNX_ARRAY = /\(\s*"bunx"\s*,\s*\[\s*"([^"]+)"/g;

/**
 * `run("bunx vitest ...")` — la invocación como primer argumento de
 * una llamada.
 *
 * Exige la llamada porque, si no, la prosa que habla de `bunx`
 * ("bunx lo bajaría del registro") se contaría como invocación. El
 * gate no puede auditarse a sí mismo sin que su propio texto lo
 * condene.
 */
const BUNX_CALL = /\(\s*"bunx\s+([A-Za-z@][\w@/.-]*)/g;

/**
 * `"bunx vitest ..."` — la invocación al principio de un string.
 *
 * Sólo se aplica a los **comandos** de `package.json`, que son
 * comandos y no prosa. En un fichero de código, el mismo patrón
 * contaría como invocación cualquier frase que empiece por "bunx".
 */
const BUNX_STRING = /"bunx\s+([A-Za-z@][\w@/.-]*)/g;

/**
 * `bunx vitest ...` al principio de un comando, o detrás de un
 * separador de shell (`&&`, `||`, `;`, `|`).
 */
const BUNX_CHAIN = /(?:^|&&|\|\||;|\|)\s*bunx\s+([A-Za-z@][\w@/.-]*)/g;

/** Una versión exacta: sin `^`, `~`, `>=`, `x` ni `*`. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Versión mínima de Bun que sabe leer cada `lockfileVersion` del
 * `bun.lock` del repo (x00050).
 *
 * Bun 1.3.x sólo entiende lockfile v1; la v2 (configVersion 1) llega
 * con Bun 1.4. Un pin de CI por debajo de la mínima falla en
 * `bun install --frozen-lockfile` con "Unknown lockfile version"
 * ANTES de correr un solo gate — fue la causa de la CI roja
 * persistente que el análisis 2026-09-05 reportaba sin explicar.
 */
const MIN_BUN_FOR_LOCKFILE: Readonly<Record<number, string>> = {
  1: "1.0.0",
  2: "1.4.0",
};

/** Compara versiones semver concretas; devuelve <0 si a<b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Lee el `lockfileVersion` del `bun.lock` del repo. Devuelve `null`
 * si el lockfile no existe o no declara versión (lockfile antiguo).
 */
export async function readLockfileVersion(): Promise<number | null> {
  try {
    const raw = await readFile(join(REPO_ROOT, "bun.lock"), "utf8");
    const m = /"lockfileVersion"\s*:\s*(\d+)/.exec(raw);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function withoutYamlComment(line: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if ((character === "'" || character === '"') && line[index - 1] !== "\\") {
      quote = quote === character ? null : quote ?? character;
    } else if (character === "#" && quote === null) {
      return line.slice(0, index);
    }
  }
  return line;
}

export function findBunCiProblems(source: string, minBunVersion?: string): IBunCiProblem[] {
  const problems: IBunCiProblem[] = [];
  const lines = source.split("\n");
  let runBlockIndent: number | null = null;
  let pendingSetup: { line: number; indent: number; hasVersion: boolean } | null = null;

  const finishSetup = (): void => {
    if (pendingSetup !== null && !pendingSetup.hasVersion) {
      problems.push({
        line: pendingSetup.line,
        detail: "setup-bun debe declarar bun-version con una versión concreta",
      });
    }
    pendingSetup = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = withoutYamlComment(rawLine);
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    if (pendingSetup !== null && WORKFLOW_STEP.test(line) && indent <= pendingSetup.indent && !SETUP_BUN.test(line)) {
      finishSetup();
    }

    if (SETUP_BUN.test(line)) {
      finishSetup();
      pendingSetup = { line: index + 1, indent, hasVersion: false };
    }

    const versionMatch = BUN_VERSION.exec(line);
    if (versionMatch) {
      const version = versionMatch[1] ?? "";
      if (pendingSetup !== null && indent > pendingSetup.indent) pendingSetup.hasVersion = true;
      if (!FIXED_BUN_VERSION.test(version)) {
        problems.push({
          line: index + 1,
          detail: "bun-version debe ser una versión concreta; usa semver concreta",
        });
      } else if (
        minBunVersion !== undefined &&
        compareVersions(version, minBunVersion) < 0
      ) {
        problems.push({
          line: index + 1,
          detail: `bun-version ${version} no sabe leer el lockfile del repo; mínimo ${minBunVersion}`,
        });
      }
    }

    const runMatch = RUN_STEP.exec(line);
    if (runMatch) {
      const command = runMatch[2]?.trim() ?? "";
      runBlockIndent = command === "|" || command === ">" ? runMatch[1]?.length ?? 0 : null;
      if (command !== "|" && command !== ">" && BUN_INSTALL_COMMAND.test(command) && !command.includes("--frozen-lockfile")) {
        problems.push({
          line: index + 1,
          detail: "bun install debe incluir --frozen-lockfile",
        });
      }
      continue;
    }

    if (runBlockIndent !== null && (trimmed === "" || indent > runBlockIndent) && !trimmed.startsWith("#") && BUN_INSTALL_COMMAND.test(trimmed) && !trimmed.includes("--frozen-lockfile")) {
      problems.push({
        line: index + 1,
        detail: "bun install debe incluir --frozen-lockfile",
      });
    } else if (runBlockIndent !== null && trimmed !== "" && indent <= runBlockIndent) {
      runBlockIndent = null;
    }
  }

  finishSetup();
  return problems;
}

async function main(): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  const lockfileVersion = await readLockfileVersion();
  const minBun =
    lockfileVersion !== null
      ? (MIN_BUN_FOR_LOCKFILE[lockfileVersion] ?? undefined)
      : undefined;
  const entries = await readdir(WORKFLOWS_DIR, { withFileTypes: true });
  const workflows = entries
    .filter((entry) => entry.isFile() && WORKFLOW_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const problems: Array<IBunCiProblem & { readonly file: string }> = [];

  for (const workflow of workflows) {
    const path = join(WORKFLOWS_DIR, workflow);
    const source = await readFile(path, "utf8");
    for (const problem of findBunCiProblems(source, minBun)) {
      problems.push({ file: workflow, ...problem });
    }
  }

  // Las herramientas que el repo invoca por su nombre: tienen que estar
  // declaradas y fijadas por el lockfile, o el gate depende del día.
  const facts = await readToolFacts();
  const gateEntries = await readdir(GATES_DIR, { withFileTypes: true });
  const toolSources: Array<{ file: string; source: string; kind: TSourceKind }> = [];
  for (const entry of gateEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    toolSources.push({
      file: `scripts/gates/${entry.name}`,
      source: await readFile(join(GATES_DIR, entry.name), "utf8"),
      kind: "code",
    });
  }
  const manifest = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8")) as {
    scripts?: Record<string, string>;
  };
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    // Entre comillas para que la invocación se detecte como lo que es:
    // un comando que empieza por `bunx`, y no una mención en prosa.
    toolSources.push({ file: `package.json (${name})`, source: `"${command}"`, kind: "command" });
  }
  const tools = findBunxTools(toolSources);
  problems.push(...findToolProblems(tools, facts));

  if (problems.length > 0) {
    console.error(`lint:bun-ci — ${problems.length} deriva(s) encontrada(s):`);
    for (const problem of problems) {
      console.error(`  ✗ ${problem.file}:${problem.line} — ${problem.detail}`);
    }
    return 1;
  }

  console.log(
    `lint:bun-ci — ${workflows.length} workflow(s) y ${tools.length} herramienta(s) por nombre revisado(s), sin deriva` +
      (minBun ? ` (lockfile v${lockfileVersion} ⇒ bun ≥ ${minBun})` : ""),
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}

/**
 * Si una línea es sólo un comentario.
 *
 * Se decide por su forma, no parseando el fichero: un stripper de
 * comentarios tiene que entender las regex literales de JavaScript
 * (`/\(\s*"bunx"/` no es el principio de un string), y el que lo hace
 * mal se lleva por delante el resto del fichero. Con esta forma, la
 * línea se salta o no se salta, y siempre es el mismo sitio.
 */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** Un binario que el repo invoca por su nombre. */
export interface IBunxTool {
  /** El binario que se invoca (`tsc`, `vitest`). */
  readonly tool: string;
  /** El paquete que lo provee; vacío si todavía no está mapeado. */
  readonly package: string;
  /** Dónde se invoca. */
  readonly file: string;
  /** La línea de la invocación. */
  readonly line: number;
}

/**
 * De dónde viene un texto que hay que mirar.
 *
 * En **código** la invocación es una llamada: `spawnSync("bunx", [...])`
 * o `run("bunx vitest")`. En un **comando** es un comando: `bunx
 * vitest run`. La diferencia importa porque un fichero de código
 * contiene prosa —y la prosa que habla de `bunx` no es una invocación.
 */
export type TSourceKind = "code" | "command";

/**
 * Las herramientas que se invocan con `bunx` en un conjunto de
 * ficheros.
 */
export function findBunxTools(
  sources: ReadonlyArray<{ readonly file: string; readonly source: string; readonly kind: TSourceKind }>,
): IBunxTool[] {
  const tools: IBunxTool[] = [];
  const seen = new Set<string>();
  for (const { file, source, kind } of sources) {
    const patterns = kind === "command" ? [BUNX_STRING, BUNX_CHAIN] : [BUNX_ARRAY, BUNX_CALL];
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (isCommentLine(line)) continue;
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match = pattern.exec(line);
        while (match !== null) {
          const tool = match[1] ?? "";
          const key = `${file}:${index + 1}:${tool}`;
          if (tool !== "" && !seen.has(key)) {
            seen.add(key);
            tools.push({ tool, package: BINARY_TO_PACKAGE[tool] ?? "", file, line: index + 1 });
          }
          match = pattern.exec(line);
        }
      }
    }
  }
  return tools;
}

/** Lo que el repo declara y lo que el lockfile fija. */
export interface IToolFacts {
  /** La spec declarada en `package.json` (dependencies + devDependencies). */
  readonly declared: Readonly<Record<string, string>>;
  /** La spec que el workspace raíz del lockfile declara. */
  readonly lockSpecs: Readonly<Record<string, string>>;
  /** La versión que el lockfile resuelve para cada paquete. */
  readonly lockResolved: Readonly<Record<string, string>>;
}

/**
 * Parsea el `bun.lock`.
 *
 * El lockfile es JSON con comas colgantes, así que `JSON.parse` lo
 * rechaza. Quitar las comas colgantes antes de parsearlo es seguro
 * aquí porque ninguna cadena del fichero contiene ",}" ni ",]": son
 * versiones, nombres y hashes.
 */
export function parseJsonc(source: string): unknown {
  return JSON.parse(source.replace(/,(\s*[}\]])/g, "$1"));
}

/** Lee lo que declara el `package.json` y lo que fija el `bun.lock`. */
export async function readToolFacts(): Promise<IToolFacts> {
  const manifest = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };

  const lock = parseJsonc(await readFile(LOCKFILE_PATH, "utf8")) as {
    workspaces?: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
    packages?: Record<string, unknown>;
  };
  const root = lock.workspaces?.[""] ?? {};
  const lockSpecs = { ...root.dependencies, ...root.devDependencies };

  const lockResolved: Record<string, string> = {};
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    const first = Array.isArray(entry) ? entry[0] : undefined;
    if (typeof first !== "string") continue;
    const at = first.lastIndexOf("@");
    if (at <= 0) continue;
    lockResolved[name] = first.slice(at + 1);
  }

  return { declared, lockSpecs, lockResolved };
}

/**
 * Los problemas de las herramientas invocadas por nombre.
 *
 * El invariante: **lo que el repo ejecuta tiene que estar declarado y
 * fijado por el lockfile**. Una herramienta que se baja del registro
 * es una dependencia no declarada; y una versión que flota es una
 * respuesta que depende del día.
 */
export function findToolProblems(
  tools: ReadonlyArray<IBunxTool>,
  facts: IToolFacts,
): Array<IBunCiProblem & { readonly file: string }> {
  const problems: Array<IBunCiProblem & { readonly file: string }> = [];
  for (const tool of tools) {
    const name = tool.package;
    if (name === "") {
      problems.push({
        file: tool.file,
        line: tool.line,
        detail:
          `bunx ${tool.tool} no está mapeado a ningún paquete en BINARY_TO_PACKAGE: ` +
          `si no es una dependencia declarada, bunx lo descargaría al vuelo`,
      });
      continue;
    }

    const declared = facts.declared[name];
    if (declared === undefined) {
      problems.push({
        file: tool.file,
        line: tool.line,
        detail:
          `bunx ${tool.tool} usa el paquete "${name}", que no está declarado en package.json: ` +
          `bunx lo bajaría del registro y el lockfile dejaría de decidir qué se ejecuta`,
      });
      continue;
    }

    const lockSpec = facts.lockSpecs[name];
    if (lockSpec === undefined) {
      problems.push({
        file: tool.file,
        line: tool.line,
        detail: `el lockfile no declara "${name}" en el workspace raíz: la versión que corre no la fija el lockfile`,
      });
    } else if (lockSpec !== declared) {
      problems.push({
        file: tool.file,
        line: tool.line,
        detail:
          `el lockfile pide "${name}@${lockSpec}" y package.json pide "${declared}": ` +
          `bun install --frozen-lockfile fallaría`,
      });
    }

    if (facts.lockResolved[name] === undefined) {
      problems.push({
        file: tool.file,
        line: tool.line,
        detail: `el lockfile no resuelve "${name}": no hay ninguna versión fijada`,
      });
    }

    if (EXACT_VERSION_PACKAGES.has(name) && !EXACT_VERSION.test(declared)) {
      problems.push({
        file: tool.file,
        line: tool.line,
        detail:
          `la versión de "${name}" debe ser exacta ("${declared}" es un rango): ` +
          `su versión define la respuesta del gate, y un rango la deja en manos del día`,
      });
    }
  }
  return problems;
}