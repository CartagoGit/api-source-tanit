/**
 * Nodos de unión e intersección para el `SchemaGraph`.
 *
 * Dos tipos de nodo modelan combinaciones:
 *
 *   - `union`        → `oneOf` en JSON Schema: el valor debe satisfacer
 *                       **alguno** de los nodos alternativos.
 *   - `intersection` → `allOf` en JSON Schema: el valor debe satisfacer
 *                       **todos** los nodos.
 *
 * `anyOf` no tiene nodo propio: es semánticamente un `union` sin la
 * garantía de exclusividad que aporta OpenAPI con `oneOf`. Si el
 * scanner necesita marcar esa diferencia, lo hace poniendo el nombre en
 * el nodo (`name: 'anyOf'`) — el helper no lo distingue porque
 * estructuralmente son el mismo nodo.
 *
 * Las alternativas se guardan como **ids**, no como nodos: tener
 * referencias al grafo aquí obligaría a propagar el `ISchemaGraph` por
 * cada builder y clonarlo al copiar un nodo, que es exactamente la
 * indirección que el grafo vino a evitar.
 */
import type {
  ICompositeOptions,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";

/**
 * Construye un nodo `union` (`oneOf`).
 *
 * `alternatives` puede tener un solo elemento: `oneOf` con un único
 * candidato es legal y se aplana al candidato. No lo aplanamos aquí:
 * si el caller lo quiere plano, lo construye plano. El helper solo
 * respeta el shape que le llega.
 */
export function createUnionNode(
  alternatives: ReadonlyArray<SchemaNodeId>,
  id: SchemaNodeId,
  options: ICompositeOptions = {},
): ISchemaNode {
  return {
    id,
    kind: "union",
    alternatives: [...alternatives],
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
  };
}

/**
 * Construye un nodo `intersection` (`allOf`).
 *
 * Vacío: un `allOf` sin candidatos equivale a `true` en JSON Schema,
 * que es un caso patológico. El caller decide si pasa lista vacía
 * (el helper la respeta sin error) o si la rechaza antes de llamar.
 */
export function createIntersectionNode(
  alternatives: ReadonlyArray<SchemaNodeId>,
  id: SchemaNodeId,
  options: ICompositeOptions = {},
): ISchemaNode {
  return {
    id,
    kind: "intersection",
    alternatives: [...alternatives],
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
  };
}