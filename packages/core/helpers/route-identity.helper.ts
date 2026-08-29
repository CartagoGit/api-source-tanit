/**
 * Qué hace que dos endpoints sean el mismo endpoint.
 *
 * Esta pregunta se respondía en tres sitios, de tres formas distintas:
 *
 * | Dónde | Fórmula |
 * |---|---|
 * | `dedupeSpecs` del pipeline | `` `${method} ${uri} ${name}` `` |
 * | Invariantes de la colección | `` `${method} ${raw}` `` (+ body) |
 * | `check` (`diff.script.ts`) | `` `${method} ${normalizado}` `` (+ name) |
 *
 * Y el mismo fallo mordió **cuatro veces**, siempre por dar por hecho
 * que la URL identifica la operación. Eso vale en REST y no vale en
 * GraphQL ni en tRPC, donde hay **un** endpoint —`POST /graphql`— y lo
 * que distingue una consulta de otra es el nombre:
 *
 *   1. `dedupeSpecs` hacía que un esquema entero produjera una request.
 *   2. Los invariantes avisaban de las otras cuatro como duplicadas.
 *   3. `check` contaba 1 ruta de 5, así que no detectaba deriva ninguna:
 *      si cuatro operaciones desaparecían del código seguía diciendo
 *      1 contra 1 y dando el visto bueno.
 *   4. El scanner de OpenAPI se inventó `__params`, colado por `as any`,
 *      porque una ruta no tenía forma de decir de qué scanner venía.
 *
 * Las tres primeras se parchearon una a una. Tres apariciones del mismo
 * error no son tres despistes: son una pieza que falta. Esta es la
 * pieza.
 *
 * ## Dónde NO se usa, y por qué
 *
 * En el chequeo de duplicados de `collection-invariants.helper.ts`. No
 * es un olvido: es que pregunta **otra cosa**.
 *
 * Aquí se compara el código con la colección, y para eso hay que
 * normalizar —`/users/{id}` en el código y `/users/{{userId}}` en la
 * colección son el mismo endpoint—. Los invariantes comparan la
 * colección consigo misma, donde la normalización no aporta nada y
 * **quita**: colapsa el nombre del parámetro a `:p`, así que
 * `/busqueda/{{historico}}` y `/busqueda/{{matricula}}` —dos endpoints
 * distintos que Laravel separa con un `where()`, y que `uri.helper`
 * documenta como el caso límite conocido— pasarían a avisar como
 * duplicados.
 *
 * Un aviso falso en un invariante es peor que no tenerlo, porque el
 * siguiente que lo vea acusar sin motivo deja de leerlos. Meter las dos
 * preguntas en una función para que el recuento de duplicación bajara
 * habría sido la abstracción equivocada.
 */
import { normalizeForComparison } from "./uri.helper.js";
import type { IEndpointIdentity } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * La clave de una operación. Misma operación, misma clave.
 *
 * La URI se normaliza siempre, para que `/api/users` y `api/users` no
 * se cuenten como dos. El nombre y el cuerpo solo entran cuando están:
 * añadirlos vacíos haría que una ruta con nombre y la misma sin él
 * dejaran de coincidir, que es lo contrario de lo que se busca.
 */
export function endpointKey(identity: IEndpointIdentity): string {
  const method = identity.method.toUpperCase();
  const uri = normalizeForComparison(identity.uri);
  let key = `${method} ${uri}`;
  if (identity.name !== undefined && identity.name !== "") {
    key += ` ${identity.name}`;
  }
  if (identity.body !== undefined && identity.body !== "") {
    key += ` ${identity.body}`;
  }
  return key;
}

/**
 * Cómo se llama una operación cuando hay que enseñársela a alguien.
 *
 * `POST /graphql` repetido tres veces no dice nada: hace falta el
 * nombre para saber cuál falta. Esto es lo que convierte una lista de
 * tres líneas idénticas en una lista útil.
 */
export function describeEndpoint(identity: IEndpointIdentity): string {
  const base = `${identity.method.toUpperCase()} ${identity.uri}`;
  return identity.name !== undefined && identity.name !== ""
    ? `${base}  (${identity.name})`
    : base;
}

/**
 * ¿Este protocolo distingue operaciones por el nombre?
 *
 * No es una lista de frameworks: es una propiedad de las rutas que
 * llegan. Si varias comparten método y URI, el nombre es lo único que
 * queda — y da igual que sea GraphQL, tRPC o un JSON-RPC escrito a
 * mano. Preguntarlo así evita una lista que haya que mantener cada vez
 * que se soporte un framework nuevo.
 */
export function needsNameToDisambiguate(
  routes: ReadonlyArray<IEndpointIdentity>,
): boolean {
  const sinNombre = new Set<string>();
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${normalizeForComparison(route.uri)}`;
    if (sinNombre.has(key)) return true;
    sinNombre.add(key);
  }
  return false;
}
