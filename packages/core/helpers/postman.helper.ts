/**
 * Reusable helpers for walking and analyzing Postman collections.
 *
 * Centralizes the duplicated pathToSegments / walk / count logic that
 * used to live in each script.
 */
import type {
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
} from "../../contracts/interfaces/core/postman.interface.js";
import type { CollectionRequest } from "../../contracts/interfaces/core/helpers.interface.js";

/** Extract the path segments from a raw Postman URL. */
export function pathToSegments(rawUrl: string): string[] {
  return rawUrl
    .replace(/\{\{baseUrl\}\}/, "")
    .replace(/^https?:\/\/[^/]+/, "")
    .split("/")
    .filter(Boolean);
}

/** Relative URI (without baseUrl) from a raw URL. */
export function uriFromRaw(rawUrl: string): string {
  return pathToSegments(rawUrl).join("/");
}

/**
 * Walk the collection and return all flat requests.
 * If `folder` is passed, it's used as the prefix of the folder path.
 */
export function walkCollection(
  collection: PostmanCollection,
): CollectionRequest[] {
  const out: CollectionRequest[] = [];

  function walk(items: PostmanItem[], folder: string): void {
    for (const item of items) {
      if (item.item) {
        walk(item.item, folder ? `${folder} > ${item.name}` : item.name);
        continue;
      }
      const req = item.request as PostmanRequest;
      out.push({
        method: req.method,
        uri: uriFromRaw(req.url.raw),
        name: item.name,
        folder,
      });
    }
  }
  walk(collection.item, "");
  return out;
}

/** Count requests and folders of a collection. */
export function countItems(collection: PostmanCollection): {
  requests: number;
  folders: number;
} {
  let requests = 0;
  let folders = 0;

  function count(items: PostmanItem[]): void {
    for (const item of items) {
      if (item.item) {
        folders += 1;
        count(item.item);
      } else {
        requests += 1;
      }
    }
  }
  count(collection.item);
  return { requests, folders };
}
