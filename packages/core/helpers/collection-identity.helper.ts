/**
 * Stable identity of Postman artifacts.
 *
 * Postman uses `info._postman_id` to decide whether an import
 * **updates** an existing collection or **creates a new one**. The
 * builder was calling `crypto.randomUUID()` on every run, so
 * regenerating and re-importing left one more collection in the
 * workspace each time. Same with environments.
 *
 * Here the ID is derived from the project's identity using UUID v5
 * (RFC 4122 §4.3): same seed → same UUID, always. Two different
 * projects never collide because the seed includes the project name.
 *
 * Implemented by hand (SHA-1 + bit adjustment) to avoid adding a
 * dependency for 30 lines.
 */
import { createHash } from "node:crypto";
import type { ICollectionIdentity } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * Package's own namespace, generated once and pinned here.
 *
 * Do not change: changing it shifts ALL IDs and would cause the next
 * import to duplicate every collection that already exists in Postman.
 */
const POSTMAN_EXPORTER_NAMESPACE = "6f9b1d3e-4c2a-5e8f-9a7b-1c3d5e7f9a2b";

/**
 * Deterministic UUID v5 from a seed.
 *
 * @param seed Text that identifies the artifact (project name,
 *             environment name…). Normalized so that differences in
 *             casing or whitespace don't produce different IDs.
 */
export function stableUuid(seed: string): string {
  const normalized = normalizeSeed(seed);
  const hash = createHash("sha1");
  hash.update(uuidToBytes(POSTMAN_EXPORTER_NAMESPACE));
  hash.update(Buffer.from(normalized, "utf8"));
  const bytes = hash.digest();

  // RFC 4122: version 5 in the high nibble of byte 6, variant 10x in
  // the two high bits of byte 8.
  const out = Buffer.from(bytes.subarray(0, 16));
  out[6] = ((out[6] ?? 0) & 0x0f) | 0x50;
  out[8] = ((out[8] ?? 0) & 0x3f) | 0x80;

  const hex = out.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * ID of a project's collection.
 *
 * If the host declares `collectionId`, it's honored as-is: it's the
 * way to keep the collection in Postman even if the project is renamed
 * or moved between folders.
 */
export function collectionIdFor(identity: ICollectionIdentity): string {
  const explicit = identity.explicitId?.trim();
  if (explicit) return explicit;

  const parts = [identity.collectionName, identity.projectName, identity.framework]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));

  // Without any usable hint, a fixed seed is still better than a
  // random UUID: at least re-importing doesn't duplicate.
  return stableUuid(parts.length > 0 ? `collection:${parts.join("|")}` : "collection:unnamed");
}

/** ID of an environment, derived from its collection's ID and the environment name. */
export function environmentIdFor(collectionId: string, environmentName: string): string {
  return stableUuid(`environment:${collectionId}|${environmentName}`);
}

/**
 * Normalize the seed: lowercase, no accents, whitespace collapsed. So
 * "Mi API" and "mi  api" don't produce two different collections.
 */
function normalizeSeed(seed: string): string {
  return seed
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert a canonical UUID to its 16 bytes.
 *
 * The return type is annotated as `Uint8Array` and not as this
 * package's ambient `BufferLike`: the delendai plugin imports this
 * helper and is typed with `@types/node`, where that name doesn't
 * exist. `Uint8Array` is standard and both worlds understand it.
 */
function uuidToBytes(uuid: string): Uint8Array {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}
