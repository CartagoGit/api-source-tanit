/**
 * The invariants of a well-formed Postman v2.1.0 collection.
 *
 * ## Why this lives here and not in the CLI
 *
 * The same reason as the drift check: the validation lived inside
 * `packages/cli/commands/validate-json.script.ts`, so only the command
 * line could ask "is this collection well-formed?". The app's
 * validation screen had nothing to call.
 *
 * Now the invariants are a **service**, and the CLI and the
 * Application API both ask it. The messages are the service's, and
 * they are in English: they are product surface, and the product
 * surface speaks one language.
 */
import { countItems } from "../helpers/postman.helper.js";
import { POSTMAN_SCHEMA_URL } from "../../contracts/constants/core/postman.constant.js";
import type {
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
} from "../../contracts/interfaces/core/postman.interface.js";
import type {
  IValidationIssue,
  IValidationResult,
} from "../../contracts/interfaces/core/application-api.interface.js";

/** Adds the issues of one request to the list. */
function walk(items: PostmanItem[], issues: IValidationIssue[], path: string): void {
  for (const item of items) {
    const here = `${path}/${item.name}`;
    if (!item.name) {
      issues.push({ severity: "error", message: `Item without a name in ${path || "the collection"}` });
    }
    if (!item.item && !item.request) {
      issues.push({
        severity: "error",
        message: `Item '${here}' is neither a folder nor a request`,
      });
      continue;
    }
    if (item.item) {
      walk(item.item, issues, here);
      continue;
    }
    const request = item.request as PostmanRequest;
    if (!request.method) {
      issues.push({ severity: "error", message: `Request '${here}' has no method` });
    }
    if (!request.header || !Array.isArray(request.header)) {
      issues.push({
        severity: "error",
        message: `Request '${here}' has no header array`,
      });
    } else {
      for (const header of request.header) {
        if (!header.key || !header.value) {
          issues.push({
            severity: "error",
            message: `Invalid header in '${here}': ${JSON.stringify(header)}`,
          });
        }
      }
    }
    if (!request.url || !request.url.raw || !request.url.host || !request.url.path) {
      issues.push({
        severity: "error",
        message: `Invalid URL in '${here}': ${JSON.stringify(request.url)}`,
      });
    }
    if (request.body?.mode === "raw" && request.body.raw) {
      try {
        JSON.parse(request.body.raw);
      } catch (error) {
        issues.push({
          severity: "warning",
          message: `Body in '${here}' is not parseable JSON: ${(error as Error).message}`,
        });
      }
    }
  }
}

/**
 * Checks a collection against the invariants.
 *
 * @param collection The collection to check.
 * @param collectionPath Where it came from, for the report.
 * @returns The errors, the warnings, and the counts.
 */
export function validatePostmanCollection(
  collection: PostmanCollection,
  collectionPath: string,
): IValidationResult {
  const issues: IValidationIssue[] = [];

  if (!collection.info?.name) {
    issues.push({ severity: "error", message: "info.name is missing" });
  }
  if (!collection.info?.schema) {
    issues.push({ severity: "error", message: "info.schema is missing" });
  } else if (collection.info.schema !== POSTMAN_SCHEMA_URL) {
    issues.push({
      severity: "error",
      message: `info.schema should be '${POSTMAN_SCHEMA_URL}', got '${collection.info.schema}'`,
    });
  }
  if (!collection.info?._postman_id) {
    issues.push({
      severity: "warning",
      message: "info._postman_id is missing (Postman will generate one on import)",
    });
  }

  if (!Array.isArray(collection.variable)) {
    issues.push({ severity: "error", message: "collection.variable is missing" });
  } else {
    for (const variable of collection.variable) {
      if (!variable.key || variable.value === undefined) {
        issues.push({
          severity: "error",
          message: `Invalid variable: ${JSON.stringify(variable)}`,
        });
      }
    }
  }

  if (!collection.auth) {
    issues.push({
      severity: "warning",
      message: "No collection-level auth (every request will need auth set by hand)",
    });
  }

  if (!Array.isArray(collection.item) || collection.item.length === 0) {
    issues.push({ severity: "error", message: "collection.item is empty or missing" });
  } else {
    walk(collection.item, issues, "");
  }

  const { requests, folders } = countItems(collection);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    requests,
    folders,
    variables: collection.variable?.length ?? 0,
    collectionPath,
  };
}
