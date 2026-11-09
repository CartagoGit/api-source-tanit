#!/usr/bin/env bun
/**
 * Gate empírico: genera la colección de cada proyecto de `examples/` y
 * comprueba que sale algo que Postman puede importar y usar.
 *
 * Implementa p00018 S2. Es la diferencia entre "los tests pasan" y "el
 * paquete hace su trabajo": los tests unitarios prueban los scanners por
 * separado, esto ejecuta el pipeline completo —detección, escaneo,
 * inferencia, construcción— sobre un proyecto real de cada framework.
 *
 * No escribe nada en el repo: todo va a un directorio temporal que se
 * borra al terminar.
 *
 * Uso:
 *   bun run validate:examples
 */
import { readdir } from "node:fs/promises";
import { join, } from "node:path";
import { existsSync } from "node:fs";

import { generateWithAllFrameworks } from "../../packages/frameworks/index.js";
import { checkCollectionInvariants } from "../../packages/core/helpers/collection-invariants.helper.js";
import { countItems } from "../../packages/core/helpers/postman.helper.js";
import type { PostmanCollection } from "../../packages/contracts/interfaces/core/postman.interface.js";
import { EXAMPLES_DIR } from "../helpers/root.helper.js";
import type { ICollectionIssue } from "../../packages/contracts/interfaces/core/helpers.interface.js";

/** `example-app` no es un proyecto host: es el config de muestra. */
const NOT_A_PROJECT = new Set(["example-app"]);

interface IExampleResult {
  readonly example: string;
  readonly framework: string;
  readonly requests: number;
  readonly folders: number;
  readonly issues: ReadonlyArray<ICollectionIssue>;
}

async function listExamples(): Promise<string[]> {
  if (!existsSync(EXAMPLES_DIR)) return [];
  const entries = await readdir(EXAMPLES_DIR);
  return entries.filter((e) => e.startsWith("example-") && !NOT_A_PROJECT.has(e)).sort();
}

/**
 * Corre el pipeline completo sobre un proyecto. Mismo camino exacto que
 * `generate.script.ts`: si esto pasa, el CLI produce lo mismo.
 */
async function generateFor(projectRoot: string): Promise<{
  collection: PostmanCollection;
  framework: string;
}> {
  const result = await generateWithAllFrameworks(projectRoot);
  if (!result.match) throw new Error("el orchestrator no detectó ningún framework");
  return { collection: result.collection, framework: result.match.framework };
}

function formatRow(r: IExampleResult): string {
  const errors = r.issues.filter((i) => i.severity === "error").length;
  const warnings = r.issues.length - errors;
  const status = errors > 0 ? "FAIL" : warnings > 0 ? "warn" : "ok";
  return [
    status.padEnd(5),
    r.example.padEnd(26),
    r.framework.padEnd(12),
    String(r.requests).padStart(4),
    String(r.folders).padStart(4),
    errors > 0 ? `${errors} error(es)` : warnings > 0 ? `${warnings} aviso(s)` : "",
  ].join(" ");
}

async function main(): Promise<number> {
  const examples = await listExamples();
  if (examples.length === 0) {
    console.error("No hay proyectos en examples/. Nada que validar.");
    return 1;
  }

  const results: IExampleResult[] = [];
  const failures: string[] = [];

  for (const example of examples) {
    const projectRoot = join(EXAMPLES_DIR, example);
    try {
      const { collection, framework } = await generateFor(projectRoot);
      const counts = countItems(collection);
      const issues = checkCollectionInvariants(collection);
      results.push({
        example,
        framework,
        requests: counts.requests,
        folders: counts.folders,
        issues,
      });
      if (counts.requests === 0) {
        failures.push(`${example}: la colección no tiene ni un request`);
      }
      for (const issue of issues.filter((i) => i.severity === "error")) {
        failures.push(`${example}: ${issue.path} — ${issue.message}`);
      }
    } catch (err) {
      results.push({
        example,
        framework: "(error)",
        requests: 0,
        folders: 0,
        issues: [
          {
            severity: "error",
            path: "$",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      });
      failures.push(`${example}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    ["      ", "example".padEnd(26), "framework".padEnd(12), " req", " dir"].join(" "),
  );
  for (const r of results) console.log(formatRow(r));

  const warnings = results.flatMap((r) =>
    r.issues.filter((i) => i.severity === "warning").map((i) => `${r.example}: ${i.path} — ${i.message}`),
  );
  if (warnings.length > 0) {
    console.log(`\nAvisos (${warnings.length}):`);
    for (const w of warnings) console.log(`  · ${w}`);
  }

  if (failures.length > 0) {
    console.error(`\nFALLOS (${failures.length}):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    return 1;
  }

  console.log(`\n${results.length}/${results.length} ejemplos generan una colección válida.`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
