#!/usr/bin/env bun
/**
 * Lint: los tools del plugin no pueden leer el entorno del proceso.
 *
 * Implementa p00011. El contrato del plugin dice que la única fuente de
 * verdad es `IMcpPluginContext`. Un tool que llama a `process.cwd()` o
 * lee `process.env.X` directamente:
 *
 *   - no se puede testear (no hay forma de inyectarle un working dir),
 *   - no es portable (el cwd de producción no es el de desarrollo),
 *   - y en el caso de `process.env` filtra secretos del host.
 *
 * Alcance: `packages/plugins/mcp-vertex_expostman/**\/src/lib/tools/**\/*.ts`. Los servicios SÍ pueden
 * leer `process.env` — `POSTMAN_PROJECT_ROOT` es un fallback documentado.
 *
 * Uso:
 *   bun run lint:tools
 */
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { collectFiles } from "../../packages/core/helpers/fs-walk.helper.js";
import { REPO_ROOT } from "../helpers/root.helper.js";

const TOOLS_GLOB_ROOT = resolve(REPO_ROOT, "packages/plugins/mcp-vertex_expostman");

/** Cada regla es un patrón + la explicación de por qué está prohibido. */
interface IRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly reason: string;
}

const RULES: ReadonlyArray<IRule> = [
  {
    id: "no-process-cwd",
    pattern: /\bprocess\s*\.\s*cwd\s*\(/,
    reason: "usa ctx.workspace; process.cwd() depende de desde dónde se lance el host",
  },
  {
    id: "no-process-env",
    pattern: /\bprocess\s*\.\s*env\b/,
    reason: "usa las options del plugin (validadas con su schema Zod)",
  },
  {
    id: "no-absolute-path-literal",
    pattern: /(['"`])(?:\/(?:home|Users|var|opt|tmp)\/|~\/)[^'"`]*\1/,
    reason: "ruta absoluta hardcodeada; derívala de ctx.workspace",
  },
];

/** Una infracción concreta, con su ubicación. */
interface IViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: IRule;
  readonly source: string;
}

/**
 * Ficheros donde la prohibición se levanta — **con motivo**.
 *
 * El único caso legítimo en este plugin es el snapshot inmutable del
 * proceso (`process-snapshot.helper.ts`): su razón de existir es leer
 * `process.env` / `process.cwd()` **una vez al boot** y exponer el
 * resultado como constantes congeladas. El universal §6 ("Async I/O
 * only in hot paths; `*Sync` is boot-time only") lo permite; el gate
 * lo prohíbe por defecto porque la mayoría de los lectores del proceso
 * lo hacen en hot path. Aquí se documenta la excepción.
 */
const PERMITIDOS: Readonly<Record<string, string>> = {
  "packages/plugins/mcp-vertex_expostman/src/lib/contracts/constants/runner-snapshot.constant.ts":
    "snapshot inmutable del proceso al boot del plugin (universal §6: lectura " +
    "de proceso es boot-time); el resto del plugin consume las constantes " +
    "congeladas en vez de leer process.* en hot path",
};

/**
 * Comprueba un fuente y devuelve sus infracciones.
 *
 * Se ignoran las líneas de comentario: la prohibición se explica en el
 * JSDoc de varios tools, y citarla no es incumplirla.
 */
export function lintToolSource(file: string, source: string): IViolation[] {
  const out: IViolation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        out.push({ file, line: i + 1, rule, source: line.trim() });
      }
    }
  }
  return out;
}

async function main(): Promise<number> {
  // Los tools (`*.tool.ts`) son la superficie del plugin. Los helpers
  // (`*.helper.ts`) viven en el mismo ciclo de vida del servidor MCP
  // de vida larga, así que la prohibición del universal §6 ("no
  // process.cwd() / process.env en engines") aplica a los dos. Antes
  // solo se cubrían los tools y se les colaba `process.cwd()` desde
  // los helpers: cualquier agente que pidiera cwd vía context lo
  // recibía vacío y caía al global.
  const files = (
    await collectFiles(TOOLS_GLOB_ROOT, (name) =>
      name.endsWith(".tool.ts") || name.endsWith(".helper.ts"),
    )
  ).filter((f) => f.includes(`${"/"}src${"/"}lib${"/"}`));

  if (files.length === 0) {
    console.log("lint:tools — no se encontró ningún *.tool.ts / *.helper.ts bajo packages/plugins/mcp-vertex_expostman/src/lib/");
    return 0;
  }

  const violations: IViolation[] = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    if (PERMITIDOS[rel] !== undefined) continue;
    violations.push(...lintToolSource(file, await readFile(file, "utf8")));
  }

  if (violations.length === 0) {
    console.log(
      `lint:tools — ${files.length} tools/helpers (${Object.keys(PERMITIDOS).length} excepción con motivo), sin infracciones`,
    );
    return 0;
  }

  console.error(`lint:tools — ${violations.length} infracción(es):\n`);
  for (const v of violations) {
    console.error(`  ${relative(REPO_ROOT, v.file)}:${v.line}  [${v.rule.id}]`);
    console.error(`    ${v.source}`);
    console.error(`    → ${v.rule.reason}\n`);
  }
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
