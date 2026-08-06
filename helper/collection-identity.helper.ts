/**
 * Identidad estable de los artefactos Postman.
 *
 * Postman usa `info._postman_id` para decidir si un import **actualiza**
 * una colección existente o **crea otra nueva**. El builder llamaba a
 * `crypto.randomUUID()` en cada ejecución, así que regenerar y volver a
 * importar dejaba una colección más en el workspace cada vez. Lo mismo
 * con los environments.
 *
 * Aquí el ID se deriva de la identidad del proyecto mediante UUID v5
 * (RFC 4122 §4.3): misma semilla → mismo UUID, siempre. Dos proyectos
 * distintos nunca colisionan porque la semilla incluye su nombre.
 *
 * Se implementa a mano (SHA-1 + ajuste de bits) para no añadir una
 * dependencia por 30 líneas.
 */
import { createHash } from "node:crypto";

/**
 * Namespace propio del paquete, generado una vez y fijado aquí.
 *
 * No cambiar: cambiarlo desplaza TODOS los IDs y haría que la siguiente
 * importación duplicase cada colección ya existente en Postman.
 */
const POSTMAN_EXPORTER_NAMESPACE = "6f9b1d3e-4c2a-5e8f-9a7b-1c3d5e7f9a2b";

/**
 * UUID v5 determinista a partir de una semilla.
 *
 * @param seed Texto que identifica al artefacto (nombre del proyecto,
 *             nombre del entorno…). Se normaliza para que diferencias de
 *             mayúsculas o espacios no produzcan IDs distintos.
 */
export function stableUuid(seed: string): string {
  const normalized = normalizeSeed(seed);
  const hash = createHash("sha1");
  hash.update(uuidToBytes(POSTMAN_EXPORTER_NAMESPACE));
  hash.update(Buffer.from(normalized, "utf8"));
  const bytes = hash.digest();

  // RFC 4122: versión 5 en el nibble alto del byte 6, variante 10x en
  // los dos bits altos del byte 8.
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

/** Semilla de la colección de un proyecto. */
export interface ICollectionIdentity {
  /** ID fijado a mano por el host, si lo hay. Gana sobre todo lo demás. */
  readonly explicitId?: string | undefined;
  /** Nombre de la colección tal como se verá en Postman. */
  readonly collectionName?: string | undefined;
  /** Nombre corto del proyecto. */
  readonly projectName?: string | undefined;
  /** Framework detectado, para desempatar dos proyectos homónimos. */
  readonly framework?: string | undefined;
}

/**
 * ID de la colección de un proyecto.
 *
 * Si el host declara `collectionId`, se respeta tal cual: es la vía para
 * conservar la colección en Postman aunque se renombre o se mueva el
 * proyecto de carpeta.
 */
export function collectionIdFor(identity: ICollectionIdentity): string {
  const explicit = identity.explicitId?.trim();
  if (explicit) return explicit;

  const parts = [identity.collectionName, identity.projectName, identity.framework]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));

  // Sin ninguna pista usable, una semilla fija sigue siendo mejor que un
  // UUID aleatorio: al menos re-importar no duplica.
  return stableUuid(parts.length > 0 ? `collection:${parts.join("|")}` : "collection:unnamed");
}

/** ID de un environment, derivado del de su colección y del nombre del entorno. */
export function environmentIdFor(collectionId: string, environmentName: string): string {
  return stableUuid(`environment:${collectionId}|${environmentName}`);
}

/**
 * Normaliza la semilla: minúsculas, sin acentos, espacios colapsados.
 * Así "Mi API" y "mi  api" no producen dos colecciones distintas.
 */
function normalizeSeed(seed: string): string {
  return seed
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Convierte un UUID canónico a sus 16 bytes. */
function uuidToBytes(uuid: string): BufferLike {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}
