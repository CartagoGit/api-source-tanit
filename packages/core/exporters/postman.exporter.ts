/**
 * Postman v2.1 exporter for the universal export pipeline.
 *
 * Postman used to be a special path: the discovery pipeline built its
 * collection directly and every other format went through the exporter
 * registry. This adapter makes Postman one exporter among the others
 * without changing the collection the legacy pipeline already builds.
 */
import type { IGenerationResult } from "../../contracts/interfaces/core/discovery.interface.js";
import type {
  IExporter,
  IExportResult,
} from "../../contracts/interfaces/core/exporter.interface.js";
import type {
  PostmanCollection,
  PostmanItem,
  PostmanVariable,
} from "../../contracts/interfaces/core/postman.interface.js";
import type { IProjectSnapshot } from "../../contracts/interfaces/core/session.interface.js";
import { POSTMAN_SCHEMA_URL } from "../../contracts/constants/core/postman.constant.js";
import { buildCollection } from "../domain/collection-builder.service.js";

/** A collection used when the snapshot contains no discovery result. */
function emptyCollection(): PostmanCollection {
  return {
    info: {
      name: "Empty API",
      description: "No operations were discovered.",
      schema: POSTMAN_SCHEMA_URL,
    },
    variable: [],
    item: [],
  };
}

/** Whether a collection tree contains at least one request. */
function hasRequests(items: ReadonlyArray<PostmanItem>): boolean {
  return items.some(
    (item) =>
      item.request !== undefined ||
      (item.item !== undefined && hasRequests(item.item)),
  );
}

/**
 * Returns the collection produced by discovery for one service.
 *
 * A snapshot assembled by a host may contain specs without a collection.
 * In that case the exporter builds the same collection from the spec
 * catalog instead of returning an empty document.
 */
function collectionFor(result: IGenerationResult): PostmanCollection {
  if (hasRequests(result.collection.item)) return result.collection;
  if (result.specs.length === 0) return result.collection;

  const collection = buildCollection(
    [...result.specs],
    result.config,
    result.authScheme,
  );
  return {
    ...collection,
    ...(result.collection.auth !== undefined
      ? { auth: result.collection.auth }
      : {}),
    variable:
      result.collection.variable.length > 0
        ? result.collection.variable
        : collection.variable,
  };
}

/** Replaces the generic base URL variable with one service's variable. */
function rewriteBaseUrl(
  item: PostmanItem,
  variableName: string,
): PostmanItem {
  const request = item.request;
  const url = request?.url;
  const raw = url?.raw?.replaceAll("{{baseUrl}}", `{{${variableName}}}`);
  const host = url?.host.map((part) =>
    part === "{{baseUrl}}" ? `{{${variableName}}}` : part,
  );

  return {
    ...item,
    ...(request !== undefined
      ? {
          request: {
            ...request,
            ...(url !== undefined
              ? {
                  url: {
                    ...url,
                    ...(raw !== undefined ? { raw } : {}),
                    ...(host !== undefined ? { host } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(item.item !== undefined
      ? {
          item: item.item.map((child) => rewriteBaseUrl(child, variableName)),
        }
      : {}),
  };
}

/** Adds a variable once, keeping the first value that declared it. */
function appendVariable(
  variables: PostmanVariable[],
  variable: PostmanVariable,
): void {
  if (variables.some((candidate) => candidate.key === variable.key)) return;
  variables.push(variable);
}

/**
 * Merges the collections of several services into one Postman collection.
 *
 * Each service keeps its own base URL variable. The first service is not
 * special: its URL and auth are not inherited by its siblings.
 */
function mergeCollections(
  results: ReadonlyArray<IGenerationResult>,
): PostmanCollection {
  const first = results[0];
  if (first === undefined) return emptyCollection();
  if (results.length === 1) return collectionFor(first);

  const variables: PostmanVariable[] = [];
  const items: PostmanItem[] = [];

  for (const result of results) {
    const serviceId = result.serviceId ?? "default";
    const variableName = `baseUrl_${serviceId}`;
    appendVariable(variables, {
      key: variableName,
      value: result.config.baseUrl,
    });
    for (const variable of result.collection.variable) {
      if (variable.key === "baseUrl") continue;
      appendVariable(variables, variable);
    }
    for (const item of collectionFor(result).item) {
      items.push(rewriteBaseUrl(item, variableName));
    }
  }

  return {
    ...first.collection,
    variable: variables,
    item: items,
  };
}

/**
 * Builds a Postman collection from a project snapshot.
 *
 * The exporter never writes: the CLI owns output paths and performs the
 * atomic write after every selected exporter has produced its result.
 */
class PostmanExporter implements IExporter<PostmanCollection> {
  readonly id = "postman";
  readonly capabilities = {
    transports: ["http"],
    schemas: "partial",
    responses: "partial",
    auth: "partial",
    examples: true,
    multiService: true,
  } as const;

  async build(
    snapshot: IProjectSnapshot,
  ): Promise<IExportResult<PostmanCollection>> {
    const results = snapshot.results;
    const artifact =
      results.length === 0 ? emptyCollection() : mergeCollections(results);
    const diagnostics = results.flatMap((result) =>
      result.warnings.map((message) => ({
        code: "postman_warning",
        severity: "warning" as const,
        message,
        exporterId: "postman" as const,
      })),
    );

    return {
      format: this.id,
      artifact,
      files: [],
      diagnostics,
    };
  }
}

export { PostmanExporter };
