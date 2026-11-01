/**
 * Validates that the generated JSON satisfies the invariants of a
 * well-formed Postman v2.1.0 collection.
 *
 * Exits with a non-zero code if any invariant fails.
 *
 * Usage:
 *   bun scripts/validate-json.script.ts
 *   bun run check
 */
import { readFile } from "node:fs/promises";
import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import { validatePostmanCollection } from "../../core/domain/collection-validator.service.js";
import { outputCollectionPath } from "../../core/discovery/output-paths.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";

/**
 * The invariants live in the core
 * (`collection-validator.service.ts`), so the CLI and the Application
 * API answer "is this collection well-formed?" with the same code.
 * What is left here is what only the CLI does: find the file and
 * print the answer.
 */

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let projectName: string | undefined;
  let resolvedContext: IProjectContext | undefined;
  try {
    // Explicit context (r00008 S1): as with the rest of commands, the
    // loader must not fall back to the singleton to figure out which
    // project it is.
    resolvedContext = resolveProjectContext({ argv });
    const loaded = await loadProject(argv, resolvedContext);
    projectName = loaded.config.name;
  } catch {
    // validate puede correr solo con el JSON ya generado
  }
  const COLLECTION_PATH = await outputCollectionPath(
    resolvedContext,
    projectName,
  );
  let raw: string;
  try {
    raw = await readFile(COLLECTION_PATH, "utf8");
  } catch (e) {
    console.error(
      `✘ Cannot read ${COLLECTION_PATH}: ${(e as Error).message}`,
    );
    console.error("  Run `generate` first to produce it.");
    return 1;
  }

  let collection: PostmanCollection;
  try {
    collection = JSON.parse(raw) as PostmanCollection;
  } catch (e) {
    console.error(`✘ JSON inválido: ${(e as Error).message}`);
    return 1;
  }

  const issues = validatePostmanCollection(collection, COLLECTION_PATH);

  console.log(`→ ${COLLECTION_PATH}`);
  console.log(`  · ${issues.requests} requests in ${issues.folders} carpetas`);
  console.log(`  · ${issues.variables} variables`);
  console.log();

  if (issues.errors.length > 0) {
    console.error(`✘ ${issues.errors.length} errores:`);
    for (const e of issues.errors) console.error(`    ${e.message}`);
  }
  if (issues.warnings.length > 0) {
    console.warn(`! ${issues.warnings.length} advertencias:`);
    for (const w of issues.warnings) console.warn(`    ${w.message}`);
  }
  if (issues.errors.length === 0 && issues.warnings.length === 0) {
    console.log("✔ Valid Postman v2.1.0 collection.");
    return 0;
  }
  return issues.errors.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main());
}
