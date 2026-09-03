/**
 * Aplanar un `SchemaGraph` a la lista plana `IEndpointField[]`.
 *
 * Los exportadores que aún no saben consumir el grafo (la colección
 * Postman, por ejemplo) necesitan una lista de campos por endpoint.
 * Hasta ahora esa lista salía de `IValidationSpec[]` por scanner; con
 * `SchemaGraph` en escena, la fuente es el grafo y el aplanado es este
 * helper.
 *
 * ## Lo que **no** es
 *
 * No es una traducción fiel: el grafo puede expresar cosas que la lista
 * plana no tiene (objetos anidados como tipo, tuplas, uniones). El
 * flatten emite lo que cabe —un campo por cada escalar accesible— y
 * resigna lo demás. Su propósito es **no romper** los exportadores
 * legacy mientras los scanners migran al grafo, no ser la fuente de
 * verdad.
 *
 * ## Forma del resultado
 *
 * El array resultante tiene la misma forma que `EndpointSpec.fields`:
 * cada elemento es `IEndpointField` con `fieldName`, `type` y
 * `required`. Los nodos compuestos (`object`, `array`, `union`,
 * `intersection`) se **recorren** y producen varios `IEndpointField`.
 * Los nodos `reference` se **siguen** y se aplana lo que apuntan.
 * Los nodos `literal` y `nullable` se **emiten como string**, que es
 * el tipo más cercano en la lista plana.
 *
 * Ciclos en `reference` se cortan: si un nodo referencia a un nodo que
 * ya estamos visitando, emitimos un solo campo escalar `string` con
 * `required: false` y seguimos. Sin eso, un modelo recursivo
 * (`User.parent: User`) agotaría la pila.
 */
import type { IEndpointField } from "../../contracts/interfaces/core/postman.interface.js";
import type {
  ISchemaConstraints,
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";
import { resolveReference } from "./reference.helper.js";

/** Localización por defecto del aplanado (los `IEndpointField` la piden). */
type TFieldLocation = IEndpointField["location"];

/**
 * Aplana el grafo a partir de su raíz.
 *
 * Atajo para `flattenFrom(graph, graph.root, "body")`.
 */
export function flatten(
  graph: ISchemaGraph,
  location: TFieldLocation = "body",
): IEndpointField[] {
  return flattenFrom(graph, graph.root, location);
}

/**
 * Aplana un subgrafo empezando por un nodo concreto.
 *
 * `rootId` debe estar en `graph.nodes`. Si no lo está, devuelve `[]`:
 * el grafo no contiene la raíz, así que tampoco tiene qué aplanar.
 *
 * `location` es la ubicación que se les pone a los campos emitidos.
 * Un mismo grafo puede aplanarse una vez con `body` y otra con `query`
 * si al caller le interesa (no es el caso hoy, pero la función lo
 * admite sin coste).
 */
export function flattenFrom(
  graph: ISchemaGraph,
  rootId: SchemaNodeId,
  location: TFieldLocation,
): IEndpointField[] {
  const visiting = new Set<SchemaNodeId>();
  return visit(graph, rootId, location, visiting);
}

function visit(
  graph: ISchemaGraph,
  nodeId: SchemaNodeId,
  location: TFieldLocation,
  visiting: Set<SchemaNodeId>,
): IEndpointField[] {
  if (visiting.has(nodeId)) {
    // Ciclo: cortamos con un campo string opaco. La información
    // completa se queda en el grafo, donde el exportador que sabe leerlo
    // puede detectarla.
    return [stringField("<cycle>", location, false)];
  }
  const node = graph.nodes.get(nodeId);
  if (!node) return [];
  visiting.add(nodeId);
  try {
    return visitNode(graph, node, location, visiting);
  } finally {
    visiting.delete(nodeId);
  }
}

function visitNode(
  graph: ISchemaGraph,
  node: ISchemaNode,
  location: TFieldLocation,
  visiting: Set<SchemaNodeId>,
): IEndpointField[] {
  switch (node.kind) {
    case "scalar":
      return [scalarField(node, location)];
    case "enum":
      return [enumField(node, location)];
    case "literal":
      // La lista plana no tiene literal; caemos a `string`.
      return [stringField(node.name ?? "<literal>", location, false)];
    case "object":
      return (node.children ?? []).flatMap((edge) =>
        visit(graph, edge.node, location, visiting).map((f) => ({
          ...f,
          fieldName: edge.name,
          required: edge.required ?? f.required,
        })),
      );
    case "array": {
      const itemEdge = (node.children ?? [])[0];
      if (!itemEdge) {
        return [
          {
            fieldName: node.name ?? "<array>",
            location,
            type: "array",
            required: false,
          },
        ];
      }
      // Aplanamos el item con prefijo `items.<field>` para no chocar
      // con los campos del padre si los hubiera.
      return visit(graph, itemEdge.node, location, visiting).map((f) => ({
        ...f,
        fieldName: `items.${f.fieldName}`,
      }));
    }
    case "tuple":
      // Las tuplas tienen cardinalidad fija; aquí perdemos el índice y
      // emitimos todos los elementos como `array` con prefijo posicional.
      return (node.children ?? []).flatMap((edge) =>
        visit(graph, edge.node, location, visiting).map((f) => ({
          ...f,
          fieldName: `${edge.name}.${f.fieldName}`,
        })),
      );
    case "union":
    case "intersection":
      return (node.alternatives ?? []).flatMap((alt) =>
        visit(graph, alt, location, visiting),
      );
    case "reference": {
      const target = node.ref ? resolveReference(graph, node.ref) : undefined;
      if (!target) return [];
      return visit(graph, target.id, location, visiting);
    }
    case "nullable":
      if (!node.inner) return [];
      // La nulabilidad se aplana: el campo ya era opcional en la lista
      // plana (no había forma de exigirlo). Lo propagamos como no
      // requerido y dejamos que el caller lo afine.
      return visit(graph, node.inner, location, visiting).map((f) => ({
        ...f,
        required: false,
      }));
  }
}

function scalarField(node: ISchemaNode, location: TFieldLocation): IEndpointField {
  const field: { -readonly [K in keyof IEndpointField]: IEndpointField[K] } = {
    fieldName: node.name ?? "<scalar>",
    location,
    type: node.scalarType ?? "any",
    required: false,
  };
  applyConstraints(field, node.constraints);
  return field;
}

function enumField(node: ISchemaNode, location: TFieldLocation): IEndpointField {
  const field: { -readonly [K in keyof IEndpointField]: IEndpointField[K] } = {
    fieldName: node.name ?? "<enum>",
    location,
    type: "enum",
    required: false,
    enumValues: node.enumValues,
  };
  applyConstraints(field, node.constraints);
  return field;
}

function stringField(name: string, location: TFieldLocation, required: boolean): IEndpointField {
  return { fieldName: name, location, type: "string", required };
}

function applyConstraints(
  field: { -readonly [K in keyof IEndpointField]: IEndpointField[K] },
  constraints: ISchemaConstraints | undefined,
): void {
  if (!constraints) return;
  if (constraints.format !== undefined) field.format = constraints.format;
  if (constraints.minimum !== undefined) field.minimum = constraints.minimum;
  if (constraints.maximum !== undefined) field.maximum = constraints.maximum;
  if (constraints.minLength !== undefined) field.minLength = constraints.minLength;
  if (constraints.maxLength !== undefined) field.maxLength = constraints.maxLength;
}