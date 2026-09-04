/**
 * Las aserciones que lleva cada request de la colección.
 *
 * Una colección que solo trae URLs y métodos deja todo el trabajo de
 * comprobar a quien la importa: le da al Send, mira la respuesta y
 * decide con los ojos. El objetivo aquí es que la colección **sepa** qué
 * es una respuesta buena para cada endpoint, y lo diga sola.
 *
 * La regla que gobierna este fichero: **no se afirma nada que no se
 * sepa**. Es la misma que en `auth-scheme.service.ts`, y por el mismo
 * motivo — una aserción falsa es peor que ninguna, porque falla en rojo
 * y manda a alguien a investigar un problema que no existe.
 *
 * En concreto:
 *
 *   - El código esperado sale de la **semántica del método**, no de un
 *     200 fijo. Un `POST` que crea contesta 201, un `DELETE` contesta
 *     204 sin cuerpo, y exigirles 200 a los dos daría rojo en una API
 *     perfectamente correcta. Se acepta el rango que la especificación
 *     considera correcto para ese verbo.
 *   - El cuerpo solo se comprueba **si tiene que haberlo**. Un 204 no
 *     trae JSON, y `pm.response.json()` sobre un cuerpo vacío lanza.
 *   - No se comprueba la **forma** de la respuesta. Este proyecto escanea
 *     lo que la API **recibe**; lo que devuelve no lo sabe, y afirmar que
 *     un `GET /users` devuelve un array sería adivinar.
 */
import type { EndpointSpec, PostmanEvent } from "../../contracts/interfaces/core/postman.interface.js";

/**
 * Códigos que son un éxito según el verbo.
 *
 * No es un 200 para todo: `POST` normalmente crea (201), `DELETE` suele
 * contestar sin cuerpo (204), y muchas APIs aceptan trabajo asíncrono
 * con 202. Se admite el conjunto razonable para cada uno en vez de
 * obligar a la API a parecerse a una idea concreta.
 */
const SUCCESS_CODES: Readonly<Record<string, ReadonlyArray<number>>> = {
  GET: [200, 204, 206],
  POST: [200, 201, 202, 204],
  PUT: [200, 201, 202, 204],
  PATCH: [200, 202, 204],
  DELETE: [200, 202, 204],
  HEAD: [200, 204],
  OPTIONS: [200, 204],
};

/** Códigos que no traen cuerpo, así que no se le pide JSON. */
const NO_BODY_CODES = [204, 205, 304];

/**
 * Cuánto puede tardar una respuesta antes de que merezca una mirada.
 *
 * Es un aviso, no un contrato: 2 segundos es holgado para una API local
 * o de staging, que es donde se ejecuta una colección de Postman.
 */
const SLOW_RESPONSE_MS = 2000;

/** Las aserciones de un endpoint, listas para el campo `event`. */
export function buildTestScript(spec: EndpointSpec): PostmanEvent {
  const codes = SUCCESS_CODES[spec.method] ?? [200];
  const list = codes.join(", ");
  const mightHaveBody = codes.some((c) => !NO_BODY_CODES.includes(c));

  const exec: string[] = [
    `// Generado por Tanit. Se puede editar: no se`,
    `// sobreescribe al regenerar si cambias el nombre del test.`,
    `pm.test("Status is a success for ${spec.method}", function () {`,
    `    pm.expect([${list}]).to.include(pm.response.code);`,
    `});`,
    ``,
    `pm.test("Responds in under ${SLOW_RESPONSE_MS} ms", function () {`,
    `    pm.expect(pm.response.responseTime).to.be.below(${SLOW_RESPONSE_MS});`,
    `});`,
  ];

  if (mightHaveBody) {
    exec.push(
      ``,
      `// Un 204 no trae cuerpo, así que pedirle JSON lanzaría.`,
      `pm.test("Body is valid JSON when there is one", function () {`,
      `    if ([${NO_BODY_CODES.join(", ")}].includes(pm.response.code)) return;`,
      `    if (!(pm.response.headers.get("Content-Type") || "").includes("json")) return;`,
      `    pm.response.to.be.json;`,
      `});`,
    );
  }

  return { listen: "test", script: { type: "text/javascript", exec } };
}

/**
 * Añade las aserciones a un item sin pisar lo que ya tuviera.
 *
 * El endpoint de login ya trae su script de guardar el token, y el de
 * logout el de borrarlo. Sustituir el array entero se los llevaría por
 * delante y la colección dejaría de autenticar sola — que es la razón de
 * ser del flujo de auth.
 */
export function appendTestScript(
  existing: ReadonlyArray<PostmanEvent> | undefined,
  spec: EndpointSpec,
): PostmanEvent[] {
  return [...(existing ?? []), buildTestScript(spec)];
}
