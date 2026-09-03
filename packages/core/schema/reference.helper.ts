/**
 * Nodos de referencia y resolución de `$ref` en el `SchemaGraph`.
 *
 * Una referencia es un nodo con `kind: 'reference'` y `ref` apuntando
 * al id de otro nodo del mismo grafo. Permite:
 *
 *   - **Recursión**: un nodo `User` con campo `parent: $ref User`.
 *   - **Reuso**: un mismo tipo `SchemaNodeId` citado desde dos lugares.
 *   - **Forward references**: declarar un nodo antes de tener todos sus
 *     campos y resolverlo al cerrar el grafo.
 *
 * La resolución es **local primero**: si el grafo contiene el destino,
 * el nodo se puede sustituir por su árbol completo o por un `$ref`
 * nominal (`#/components/schemas/<name>`). Si no lo contiene, el
 * destino queda como un id externo y el exportador decide qué hacer
 * (los scanners que detectan OpenAPI lo resuelven contra el documento
 * original; los demás lo emiten literal). Network fetch queda fuera del
 * scope actual (a00010 S6 lo deja como follow-up).
 */
import type {
  IReferenceOptions,
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";

/**
 * Construye un nodo `reference`.
 *
 * El id del nodo referencia (`ref`) debe existir en el grafo destino.
 * Comprobarlo al construir costaría O(n) en cada nodo y se vuelve
 * frágil en grafos en construcción: el builder suele añadir el
 * destino **después** del `reference` y la verificación temprana
 * fallaría. La invariante se valida al cierre (`resolveReference` o
 * en `flatten-helper`), no en cada `add`.
 */
export function createReferenceNode(
  ref: SchemaNodeId,
  id: SchemaNodeId,
  options: IReferenceOptions = {},
): ISchemaNode {
  return {
    id,
    kind: "reference",
    ref,
    ...(options.name !== undefined ? { name: options.name } : {}),
  };
}

/**
 * Resuelve un `$ref` local.
 *
 * Si el grafo contiene el destino, devuelve el nodo. Si no, devuelve
 * `undefined`: el caller decide si tratarlo como error (validación
 * estricta) o emitir el `$ref` literal (exportador laxo).
 */
export function resolveReference(
  graph: ISchemaGraph,
  ref: SchemaNodeId,
): ISchemaNode | undefined {
  return graph.nodes.get(ref);
}

/**
 * Deriva un nombre estable para usar como `$ref` nominal.
 *
 * Si el nodo tiene `name`, se usa tal cual: es el nombre lógico que el
 * scanner puso y el que cabe esperar en el documento destino. Si no,
 * se cae al id: menos bonito, pero garantiza que dos llamadas con el
 * mismo input produzcan el mismo nombre.
 *
 * Exportadores que prefieran no inventar nombres para nodos anónimos
 * deberían chequear `node.name !== undefined` antes de llamar aquí.
 */
export function deriveLocalRefName(
  node: ISchemaNode,
  fallback: (node: ISchemaNode) => string = (n) => n.id,
): string {
  return node.name ?? fallback(node);
}