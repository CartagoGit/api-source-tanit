/**
 * Serialización del `SchemaGraph` para fronteras de proceso.
 *
 * El grafo vive como `ReadonlyMap` para velocidad dentro del proceso,
 * pero `JSON.stringify(new Map(...))` devuelve `"{}"` — la información
 * se pierde. Cuando el grafo cruza una frontera (MCP, JSON, caché, UI),
 * hay que pasarlo por un DTO que **sí** es JSON-serializable.
 *
 * Este helper exporta:
 *
 *   - `createSchemaGraph(nodes, root)`: fábrica que devuelve un
 *     `ISchemaGraph` con `toDTO()` enlazado al mapa. Es la forma
 *     recomendada de construir un grafo (los builders de
 *     `build-schema-graph.helper.ts` la usan internamente).
 *   - `toDTO(graph)`: convierte cualquier `ISchemaGraph` a un
 *     `ISchemaGraphDTO`. Es la implementación del método `toDTO()`
 *     del interface y, al mismo tiempo, una función libre para los
 *     consumidores que prefieran no llamar al método.
 *   - `fromDTO(dto)`: reconstruye un `ISchemaGraph` desde un DTO. El
 *     grafo resultante incluye `toDTO()` (vía `createSchemaGraph`).
 *   - `sortByLocation(graph)`: ordena los nodos por ubicación cuando
 *     esa información esté disponible; ver nota más abajo.
 *
 * ## Determinismo
 *
 * `toDTO(graph)` produce el mismo array de `entries` cada vez, en el
 * orden de iteración del `Map` subyacente. La iteración de un `Map` en
 * JS sigue el orden de inserción, así que el DTO es estable para el
 * mismo grafo y reproducible por igualdad de contenido.
 *
 * ## Por qué `entries` y no `Record<string, ISchemaNode>`
 *
 * `Record<string, ISchemaNode>` también es JSON-serializable, pero un
 * array de `[id, node]` preserva la información de orden (importante
 * para diffs estables entre dos pasadas) y no obliga a que los ids
 * sean claves de objeto válidas (un `SchemaNodeId` puede contener `:`
 * u otros caracteres que JS trataría bien, pero la convención aquí
 * es libre — el contrato no la restringe).
 *
 * ## `sortByLocation` — sin metadatos de ubicación por ahora
 *
 * El contrato `ISchemaNode` actual no lleva `line`/`column`. La razón
 * de existir del helper es preparar el terreno para cuando los
 * scanners AST (`a00010 S7`) emitan nodos con su origen en el fuente
 * — el orden top-down del fichero debe sobrevivir la serialización.
 *
 * Hasta entonces, `sortByLocation` devuelve una copia del grafo con
 * los nodos en el orden de iteración del `Map`. Si en el futuro
 * `ISchemaNode` añade `readonly location?: { line: number; column:
 * number }`, este helper pasa a ordenar por `(line, column, id)` y
 * los DTOs de dos pasadas sobre el mismo fuente serán idénticos byte
 * a byte.
 */

import type {
  ISchemaGraph,
  ISchemaGraphDTO,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";

/**
 * Construye un `ISchemaGraph` a partir de un `Map` y un id raíz.
 *
 * Devuelve un objeto con `toDTO()` enlazado al mapa. Es la única
 * forma válida de satisfacer el interface desde código externo: los
 * literales `{ nodes: map, root }` ya no compilan porque al interface
 * le falta `toDTO`.
 *
 * Si necesitas un grafo desde un DTO, usa `fromDTO(dto)` (que a su
 * vez delega aquí).
 */
export function createSchemaGraph(
  nodes: ReadonlyMap<SchemaNodeId, ISchemaNode>,
  root: SchemaNodeId,
): ISchemaGraph {
  return {
    nodes,
    root,
    toDTO(): ISchemaGraphDTO {
      return toDTO(this);
    },
  };
}

/**
 * Convierte un `ISchemaGraph` a su DTO JSON-serializable.
 *
 * Implementa el método `toDTO()` del interface y, además, está
 * exportada como función libre. Los dos caminos producen el mismo
 * resultado: `graph.toDTO() === toDTO(graph)` para cualquier grafo.
 *
 * El array `nodes` sale en el orden de iteración del `Map` subyacente
 * (orden de inserción). Eso garantiza que dos llamadas sobre el mismo
 * grafo producen el mismo DTO, y que `fromDTO(toDTO(graph))` recupera
 * el mismo grafo por igualdad de contenido.
 */
export function toDTO(graph: ISchemaGraph): ISchemaGraphDTO {
  return {
    nodes: Array.from(graph.nodes.entries()),
    root: graph.root,
  };
}

/**
 * Reconstruye un `ISchemaGraph` desde un DTO.
 *
 * Crea un nuevo `Map` con las entradas del DTO y lo envuelve con
 * `createSchemaGraph` (que añade `toDTO`). Útil en la frontera
 * contraria: si el grafo viene como JSON desde MCP, caché o un
 * snapshot persistido, esta función lo devuelve en la forma in-memory
 * con la que trabajan los exportadores.
 */
export function fromDTO(dto: ISchemaGraphDTO): ISchemaGraph {
  return createSchemaGraph(new Map(dto.nodes), dto.root);
}

/**
 * Devuelve una copia del grafo con los nodos en orden estable.
 *
 * Hoy: la copia mantiene el orden de iteración del `Map` original
 * (que es el orden de inserción), así que el resultado es estable
 * para el mismo grafo de entrada.
 *
 * Mañana: cuando `ISchemaNode` lleve `location?: { line, column }`,
 * esta función ordena por `(line, column, id)` — el mismo orden en
 * que aparecen en el fichero fuente. Los AST frontend
 * (`a00010 S7`) producen ese orden top-down; este helper lo
 * preserva al cruzar la frontera JSON.
 */
export function sortByLocation(graph: ISchemaGraph): ISchemaGraph {
  // El interface actual no tiene `location`. Iteramos el mapa en su
  // orden (que ya es estable) y devolvemos un grafo nuevo. Cuando
  // `ISchemaNode` extienda, este es el punto a tocar.
  return createSchemaGraph(new Map(graph.nodes), graph.root);
}