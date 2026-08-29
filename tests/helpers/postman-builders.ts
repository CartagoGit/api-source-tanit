/**
 * Construir items de Postman para los tests, **incluidos los inválidos**.
 *
 * Los tests de invariantes necesitan objetos rotos a propósito: una
 * request sin método, sin URL, un item que no es ni carpeta ni petición.
 * Se construían con `as unknown as PostmanItem`, que es una aserción que
 * el compilador no puede contradecir — dieciséis veces.
 *
 * El problema de esa forma no es que sea fea: es que **no dice qué está
 * roto**. `{ name: "roto", request: { header: [] } } as unknown as
 * PostmanItem` obliga a leer el objeto entero y compararlo mentalmente
 * con el contrato para saber que le falta el método. Y si mañana el
 * contrato añade un campo obligatorio, esos dieciséis objetos siguen
 * compilando mientras el código de producción se actualiza: el casting
 * apaga exactamente la comprobación que avisaría.
 *
 * Aquí se declara **qué se quita**, con el nombre de la parte que falta.
 * El objeto de partida sí está tipado, así que un cambio en el contrato
 * rompe aquí — que es donde tiene que romper.
 */
import type {
  PostmanItem,
  PostmanRequest,
} from "../../packages/contracts/interfaces/core/postman.interface";

/** Una request válida, para partir de algo que sí cumple el contrato. */
export function validRequest(
  name: string,
  method = "GET",
  raw = "{{baseUrl}}/users",
): PostmanItem {
  return {
    name,
    request: {
      method,
      header: [],
      url: { raw, host: ["{{baseUrl}}"], path: raw.split("/").filter(Boolean) },
    },
  };
}

/** Una carpeta con lo que se le meta dentro. */
export function folder(name: string, items: PostmanItem[] = []): PostmanItem {
  return { name, item: items };
}

/** Qué parte se le quita a una request para romperla. */
export type MissingPart = "method" | "url" | "header" | "request";

/**
 * Una request a la que le falta una pieza, dicha por su nombre.
 *
 * `brokenRequest("sin método", "method")` se lee solo, y el objeto que
 * devuelve nace de uno válido — así que si el contrato cambia, esto deja
 * de compilar en vez de seguir pasando.
 */
export function brokenRequest(name: string, missing: MissingPart): PostmanItem {
  const base = validRequest(name);
  if (missing === "request") {
    return { name };
  }
  // `base.request` existe siempre: lo acaba de construir `validRequest`.
  const request: Partial<PostmanRequest> = { ...(base.request ?? {}) };
  delete request[missing];
  // La aserción vive **aquí y solo aquí**: es el único punto del repo
  // donde se afirma que un objeto incompleto vale como `PostmanItem`, y
  // es deliberado, porque el test comprueba justo qué pasa con uno así.
  // Antes esa afirmación estaba repartida en dieciséis sitios, cada uno
  // con su objeto a mano.
  return { name, request: request as PostmanRequest };
}
