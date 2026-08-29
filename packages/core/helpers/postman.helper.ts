/**
 * Helpers reutilizables para recorrer y analizar colecciones Postman.
 *
 * Centraliza la lógica duplicada de pathToSegments / walk / count
 * que antes vivía en cada script.
 */
import type {
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
} from "../../contracts/interfaces/core/postman.interface.js";
import type { CollectionRequest } from "../../contracts/interfaces/core/helpers.interface.js";

/** Extrae los segmentos de path de una URL raw de Postman. */
export function pathToSegments(rawUrl: string): string[] {
  return rawUrl
    .replace(/\{\{baseUrl\}\}/, "")
    .replace(/^https?:\/\/[^/]+/, "")
    .split("/")
    .filter(Boolean);
}

/** URI relativa (sin baseUrl) a partir de una URL raw. */
export function uriFromRaw(rawUrl: string): string {
  return pathToSegments(rawUrl).join("/");
}

/**
 * Recorre la colección y devuelve todos los requests planos.
 * Si `folder` se pasa, se usa como prefijo del path de carpetas.
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

/** Cuenta requests y carpetas de una colección. */
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
