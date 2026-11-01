#!/usr/bin/env bun
/**
 * `bun run lint:sast` — los patrones peligrosos que este proyecto puede
 * cometer de verdad.
 *
 * No es un semgrep con su catálogo de reglas genéricas. Un catálogo
 * genérico sobre un repo de TypeScript produce sobre todo ruido —
 * advertencias sobre inyección de SQL en un proyecto sin base de datos—
 * y un lint ruidoso se acaba desactivando, que es la peor forma de no
 * tener seguridad.
 *
 * Las reglas de aquí salen de lo que **esta** herramienta hace:
 *
 *   - Lee ficheros fuente de proyectos ajenos y los pasa por regex.
 *   - Lanza procesos (`bun`, el binario de Postman).
 *   - Escribe artefactos que la gente importa en Postman.
 *   - Maneja una clave de API de Postman.
 *
 * De ahí salen los cuatro peligros reales, y no otros.
 *
 * Uso:
 *   bun run lint:sast
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

interface IRule {
  readonly id: string;
  readonly re: RegExp;
  readonly why: string;
  readonly fix: string;
  /**
   * Preparación de la línea antes de aplicar el patrón.
   *
   * Por defecto se vacían los literales de cadena inertes, y eso vale
   * para **todas** las reglas: `eval(` dentro de unas comillas no es una
   * llamada, es texto. Sin esto, el propio spec de este lint —que guarda
   * los patrones peligrosos como cadenas de prueba— se acusaba a sí
   * mismo, y `console.error("usa POSTMAN_API_KEY=<key>")` contaba como
   * imprimir la clave por nombrarla.
   */
  readonly prepare?: (line: string) => string;
}

/**
 * Vacía los literales de cadena que no interpolan.
 *
 * `"usa POSTMAN_API_KEY"` pasa a `""`; `` `key: ${apiKey}` `` se queda,
 * porque ahí sí viaja un valor.
 */
function stripInertStrings(line: string): string {
  return line.replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, '""').replace(
    /`((?:\\.|[^`\\])*)`/g,
    (whole, inner: string) => (inner.includes("${") ? whole : "``"),
  );
}

const RULES: ReadonlyArray<IRule> = [
  {
    id: "eval",
    re: /\beval\s*\(|\bnew\s+Function\s*\(/,
    why:
      "ejecuta como código una cadena que puede venir del proyecto escaneado, " +
      "que es código de otra persona",
    fix: "Parsea el valor en vez de ejecutarlo.",
  },
  {
    // Lo grave no es `exec`, es `exec` con una cadena construida: ahí es
    // donde entra la shell y con ella el `;` y el `$( )`.
    id: "shell-injection",
    // Tras vaciar los literales inertes, lo que queda dentro del
    // paréntesis solo puede ser `${…}` o un `+` si de verdad se está
    // componiendo el comando con algo variable. Un
    // `execSync("command -v bun")` queda en `execSync("")` y no casa.
    re: /\bexec(?:Sync)?\s*\([^)]*(?:\$\{|\+)/,
    why:
      "compone un comando de shell con interpolación: una ruta de proyecto con " +
      "un `;` o un `$(…)` se ejecuta",
    fix:
      "Usa `spawnSync(bin, [args])`, que pasa los argumentos como array y no " +
      "abre una shell. Es lo que hace el resto del repo.",
  },
  {
    // `process.env` entero en una plantilla acaba en un artefacto que la
    // gente comparte.
    id: "env-dump",
    re: /JSON\.stringify\s*\(\s*process\.env\b|\$\{\s*JSON\.stringify\s*\(\s*process\.env/,
    why: "vuelca el entorno entero, con lo que haya dentro, a un artefacto o a un log",
    fix: "Escribe solo la variable concreta que haga falta.",
  },
  {
    id: "api-key-in-log",
    re: /console\.(?:log|error|warn|info)\s*\([^)]*\b(?:POSTMAN_API_KEY|apiKey|api_key)\b/,
    why: "imprime una clave de API por consola, y las consolas acaban en ficheros de log",
    fix: "Traza que la clave está puesta, no cuál es.",
  },
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  "export-to-postman",
  "coverage",
  // Los fixtures son código de OTROS proyectos: la entrada de los
  // scanners, no código que este repo ejecute.
  "fixtures",
  "smoke-fixtures",
  "examples",
]);

/** El propio lint enumera los patrones: no puede acusarse a sí mismo. */
const ALLOWED = new Set(["scripts/gates/lint-sast.script.ts"]);

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

interface IFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: IRule;
  readonly source: string;
}

export async function findSastIssues(
  files: ReadonlyArray<string>,
): Promise<IFinding[]> {
  const findings: IFinding[] = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (ALLOWED.has(rel)) continue;

    let source: string;
    try {
      source = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      // Los docblocks explican los patrones a propósito.
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      if (line.includes("lint:sast ignore")) continue;
      for (const rule of RULES) {
        if (rule.re.test((rule.prepare ?? stripInertStrings)(line))) {
          findings.push({ file: rel, line: i + 1, rule, source: line.trim() });
        }
      }
    }
  }
  return findings;
}

async function main(): Promise<number> {
  const files = await collect(REPO_ROOT);
  const findings = await findSastIssues(files);

  if (findings.length > 0) {
    console.error(`lint:sast — ${findings.length} patrón(es) peligroso(s):\n`);
    for (const f of findings) {
      console.error(
        `  ✗ ${f.file}:${f.line} [${f.rule.id}]\n` +
          `      ${f.source}\n` +
          `      ${f.rule.why}.\n` +
          `      ${f.rule.fix}`,
      );
    }
    console.error(
      "\n  Si en este caso concreto es seguro, añade `lint:sast ignore` en la\n" +
        "  línea explicando por qué.\n",
    );
    return 1;
  }

  console.log(
    `lint:sast — ${files.length} ficheros, ${RULES.length} reglas, sin hallazgos`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
