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
 * Alcance: `plugins/**\/src/lib/tools/**\/*.ts`. Los servicios SÍ pueden
 * leer `process.env` — `POSTMAN_PROJECT_ROOT` es un fallback documentado.
 *
 * Uso:
 *   bun run lint:tools
 */
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { collectFiles } from "../helper/fs-walk.helper.js";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const TOOLS_GLOB_ROOT = resolve(PACKAGE_ROOT, "plugins");

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
  const files = (
    await collectFiles(TOOLS_GLOB_ROOT, (name) => name.endsWith(".tool.ts"))
  ).filter((f) => f.includes(`${"/"}src${"/"}lib${"/"}tools${"/"}`));

  if (files.length === 0) {
    console.log("lint:tools — no se encontró ningún *.tool.ts bajo plugins/");
    return 0;
  }

  const violations: IViolation[] = [];
  for (const file of files) {
    violations.push(...lintToolSource(file, await readFile(file, "utf8")));
  }

  if (violations.length === 0) {
    console.log(`lint:tools — ${files.length} tools, sin infracciones`);
    return 0;
  }

  console.error(`lint:tools — ${violations.length} infracción(es):\n`);
  for (const v of violations) {
    console.error(`  ${relative(PACKAGE_ROOT, v.file)}:${v.line}  [${v.rule.id}]`);
    console.error(`    ${v.source}`);
    console.error(`    → ${v.rule.reason}\n`);
  }
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
