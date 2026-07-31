/**
 * Valida que el JSON generado cumple las invariantes de una colección
 * Postman v2.1.0 bien formada.
 *
 * Sale con código distinto de 0 si alguna invariante falla.
 *
 * Uso:
 *   bun scripts/validate-json.script.ts
 *   bun run check
 */
import { readFile } from "node:fs/promises";
import type {
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
} from "../contract/postman.interface.js";
import { POSTMAN_SCHEMA_URL } from "../contract/postman.constant.js";
import { countItems } from "../helper/postman.helper.js";
import { outputCollectionPath } from "../service/paths.service.js";
import { loadProject } from "../service/project-loader.service.js";

interface Issue {
  severity: "error" | "warning";
  message: string;
}

function walk(items: PostmanItem[], issues: Issue[], path: string): void {
  for (const item of items) {
    const here = `${path}/${item.name}`;
    if (!item.name) {
      issues.push({ severity: "error", message: `Item sin 'name' en ${path}` });
    }
    if (!item.item && !item.request) {
      issues.push({
        severity: "error",
        message: `Item '${here}' no es carpeta ni request`,
      });
      continue;
    }
    if (item.item) {
      walk(item.item, issues, here);
      continue;
    }
    const req = item.request as PostmanRequest;
    if (!req.method) {
      issues.push({
        severity: "error",
        message: `Request '${here}' sin method`,
      });
    }
    if (!req.header || !Array.isArray(req.header)) {
      issues.push({
        severity: "error",
        message: `Request '${here}' sin header array`,
      });
    } else {
      for (const h of req.header) {
        if (!h.key || !h.value) {
          issues.push({
            severity: "error",
            message: `Header inválido en '${here}': ${JSON.stringify(h)}`,
          });
        }
      }
    }
    if (!req.url || !req.url.raw || !req.url.host || !req.url.path) {
      issues.push({
        severity: "error",
        message: `URL inválida en '${here}': ${JSON.stringify(req.url)}`,
      });
    }
    if (req.body?.mode === "raw" && req.body.raw) {
      try {
        JSON.parse(req.body.raw);
      } catch (e) {
        issues.push({
          severity: "warning",
          message: `Body en '${here}' no es JSON parseable: ${(e as Error).message}`,
        });
      }
    }
  }
}

async function main(): Promise<number> {
  let projectName: string | undefined;
  try {
    const loaded = await loadProject();
    projectName = loaded.config.name;
  } catch {
    // validate puede correr solo con el JSON ya generado
  }
  const COLLECTION_PATH = await outputCollectionPath(projectName);

  let raw: string;
  try {
    raw = await readFile(COLLECTION_PATH, "utf8");
  } catch (e) {
    console.error(
      `✘ No se puede leer ${COLLECTION_PATH}: ${(e as Error).message}`,
    );
    console.error("  Ejecuta primero `bun run build` para generarlo.");
    return 1;
  }

  let collection: PostmanCollection;
  try {
    collection = JSON.parse(raw) as PostmanCollection;
  } catch (e) {
    console.error(`✘ JSON inválido: ${(e as Error).message}`);
    return 1;
  }

  const issues: Issue[] = [];

  if (!collection.info?.name)
    issues.push({ severity: "error", message: "Falta info.name" });
  if (!collection.info?.schema)
    issues.push({ severity: "error", message: "Falta info.schema" });
  else if (collection.info.schema !== POSTMAN_SCHEMA_URL) {
    issues.push({
      severity: "error",
      message: `info.schema esperado '${POSTMAN_SCHEMA_URL}', obtenido '${collection.info.schema}'`,
    });
  }
  if (!collection.info?._postman_id) {
    issues.push({
      severity: "warning",
      message: "Falta info._postman_id (Postman lo generará al importar)",
    });
  }

  if (!Array.isArray(collection.variable)) {
    issues.push({ severity: "error", message: "Falta collection.variable" });
  } else {
    for (const v of collection.variable) {
      if (!v.key || v.value === undefined) {
        issues.push({
          severity: "error",
          message: `Variable inválida: ${JSON.stringify(v)}`,
        });
      }
    }
  }

  if (!collection.auth) {
    issues.push({
      severity: "warning",
      message:
        "Sin auth a nivel de colección (todas las requests necesitarán auth manual)",
    });
  }

  if (!Array.isArray(collection.item) || collection.item.length === 0) {
    issues.push({
      severity: "error",
      message: "collection.item vacío o ausente",
    });
  } else {
    walk(collection.item, issues, "");
  }

  const { requests, folders } = countItems(collection);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  console.log(`→ ${COLLECTION_PATH}`);
  console.log(`  · ${requests} requests en ${folders} carpetas`);
  console.log(`  · ${collection.variable?.length ?? 0} variables`);
  console.log();

  if (errors.length > 0) {
    console.error(`✘ ${errors.length} errores:`);
    for (const e of errors) console.error(`    ${e.message}`);
  }
  if (warnings.length > 0) {
    console.warn(`! ${warnings.length} advertencias:`);
    for (const w of warnings) console.warn(`    ${w.message}`);
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log("✔ Colección Postman v2.1.0 válida.");
    return 0;
  }
  return errors.length > 0 ? 1 : 0;
}

process.exit(await main());
