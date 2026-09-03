/**
 * Construir un `SchemaGraph` desde `IValidationSpec[]`.
 *
 * Hasta ahora la fuente de verdad para el body era una lista plana de
 * `IValidationSpec`. Con `SchemaGraph` en escena, la lista plana sigue
 * llegando de los scanners que aún no migraron al grafo, pero se
 * **convierte** al grafo en este punto. Los exportadores que saben
 * consumir el grafo ven tipos anidados; los demás pueden aplanarlo
 * con `flatten-helper` y seguir como antes.
 *
 * ## Lo mínimo, por diseño
 *
 * El `SchemaGraph` "mínimo" no es un grafo completo: es una traducción
 * 1-a-1 de las specs a nodos, con la raíz como `object` y cada spec
 * como hijo. Esto es deliberado —los scanners aún no producen tipos
 * anidados, y reconstruir un grafo rico a partir de `address.street`
 * sería una adivinación. Cuando un scanner migre a SchemaGraph nativo
 * (a00010 S7 y siguientes), el grafo que produce puede pasar sin tocar
 * por este builder, o puede saltárselo si ya viene con nodos
 * referenciados.
 *
 * ## Determinismo
 *
 * `buildSchemaGraph(specs, rootName)` produce el mismo grafo para el
 * mismo input, en el mismo orden de inserción. Los ids se asignan con
 * un contador local, no global: dos llamadas al mismo tiempo no se
 * interfieren, y el resultado es cacheable por igualdad de input.
 */
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  IBuildOptions,
  ICompositeOptions,
  ISchemaEdge,
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";
import {
  constraintsFromValidationSpec,
  createEnumNode,
  createScalarNode,
} from "./scalar.helper.js";

/**
 * Construye un nodo `object` con los hijos dados.
 *
 * `children` se copia: mutar el array del caller después no afecta al
 * nodo. El id lo pasa el caller (típicamente, el builder) para evitar
 * colisiones en grafos en construcción.
 */
export function createObjectNode(
  id: SchemaNodeId,
  children: ReadonlyArray<ISchemaEdge>,
  options: ICompositeOptions = {},
): ISchemaNode {
  const node: { -readonly [K in keyof ISchemaNode]: ISchemaNode[K] } = {
    id,
    kind: "object",
    children: children.map((edge) => ({ ...edge })),
  };
  if (options.name !== undefined) node.name = options.name;
  if (options.constraints !== undefined) node.constraints = options.constraints;
  return node;
}

/**
 * Construye un nodo `array` cuyo único hijo es `itemId`.
 *
 * El item va en un `ISchemaEdge` con `name: "items"` y `required: true`
 * — un array sin item no es un array, y un item opcional en un array
 * no existe en JSON Schema (el `items` siempre aplica a todos los
 * elementos).
 */
export function createArrayNode(
  id: SchemaNodeId,
  itemId: SchemaNodeId,
  options: ICompositeOptions = {},
): ISchemaNode {
  const node: { -readonly [K in keyof ISchemaNode]: ISchemaNode[K] } = {
    id,
    kind: "array",
    children: [{ name: "items", node: itemId, required: true }],
  };
  if (options.name !== undefined) node.name = options.name;
  if (options.constraints !== undefined) node.constraints = options.constraints;
  return node;
}

/**
 * Builder de `SchemaGraph`.
 *
 * Mantiene un contador local de ids y un mapa de nodos. Cada `add*`
 * devuelve el id del nodo creado, así el caller puede encadenar
 * referencias sin tener que inventar ids. El builder es **monouso**:
 * tras `build()`, no admite más `add*`.
 */
export class SchemaGraphBuilder {
  private readonly map = new Map<SchemaNodeId, ISchemaNode>();
  private nextIndex = 0;
  private sealed = false;

  /** Genera el siguiente id, reservando el prefijo `kind:` para legibilidad. */
  private newId(kind: string): SchemaNodeId {
    const id = `${kind}:${this.nextIndex}`;
    this.nextIndex += 1;
    return id;
  }

  /** Garantiza que el builder sigue abierto. */
  private checkOpen(): void {
    if (this.sealed) {
      throw new Error(
        "SchemaGraphBuilder.build() ya se llamó: el builder es monouso.",
      );
    }
  }

  /** Añade un nodo ya construido al grafo y devuelve su id. */
  add(node: ISchemaNode): SchemaNodeId {
    this.checkOpen();
    if (this.map.has(node.id)) {
      throw new Error(
        `SchemaGraphBuilder: id duplicado "${node.id}". los ids deben ser únicos.`,
      );
    }
    this.map.set(node.id, node);
    return node.id;
  }

  /**
   * Construye un `object` con los hijos dados y devuelve su id.
   *
   * `children` se copia: el array del caller puede mutarse después sin
   * que el nodo del grafo se entere.
   */
  addObject(
    name: string | undefined,
    children: ReadonlyArray<ISchemaEdge>,
    options: ICompositeOptions = {},
  ): SchemaNodeId {
    this.checkOpen();
    const id = this.newId("object");
    const node: { -readonly [K in keyof ISchemaNode]: ISchemaNode[K] } = {
      id,
      kind: "object",
      children: children.map((edge) => ({ ...edge })),
    };
    if (name !== undefined) node.name = name;
    if (options.constraints !== undefined) node.constraints = options.constraints;
    this.map.set(id, node);
    return id;
  }

  /**
   * Construye un `array` cuyo único hijo es `itemId`. Devuelve el id
   * del array, no del item.
   */
  addArray(itemId: SchemaNodeId, name?: string, options: ICompositeOptions = {}): SchemaNodeId {
    this.checkOpen();
    const id = this.newId("array");
    const node: { -readonly [K in keyof ISchemaNode]: ISchemaNode[K] } = {
      id,
      kind: "array",
      children: [{ name: "items", node: itemId, required: true }],
    };
    if (name !== undefined) node.name = name;
    if (options.constraints !== undefined) node.constraints = options.constraints;
    this.map.set(id, node);
    return id;
  }

  /**
   * Cierra el grafo y devuelve la estructura inmutable.
   *
   * `rootId` debe existir en el mapa (lo creó un `add*` anterior). Si
   * no, lanza: un grafo sin raíz no es grafo, y `buildOpenApiDocument`
   * con un root que no existe daría un documento roto.
   */
  build(rootId: SchemaNodeId): ISchemaGraph {
    this.checkOpen();
    if (!this.map.has(rootId)) {
      throw new Error(
        `SchemaGraphBuilder.build(): rootId "${rootId}" no está en el mapa.`,
      );
    }
    this.sealed = true;
    return { nodes: this.map, root: rootId };
  }

  /**
   * Traduce una `IValidationSpec` a uno o dos nodos del grafo y
   * devuelve el id del principal.
   *
   * Razón de vivir como método: la implementación llama a `newId`,
   * que es privado del builder. Moverlo aquí mantiene la encapsulación
   * y deja el `buildSchemaGraph` como un orquestador de tres líneas.
   *
   * ## Tipos compuestos
   *
   * `array` se traduce a `kind: 'array'` con un `items` que es **un
   * escalar `string`** —el equivalente al `items: string` que emitía el
   * OpenAPI exporter antes. Razón: la spec plana no sabe qué tipo tiene
   * el item, y reconstruirlo de `array.of` o `items.type` (que no
   * existen en `IValidationSpec`) sería inventar. Un scanner que migre
   * a SchemaGraph nativo puede saltarse este helper y construir el
   * `array` con el item real.
   *
   * `object` se traduce a `kind: 'object'` sin hijos. La spec plana no
   * transporta sub-campos: una spec con `type: 'object'` y nombre
   * `address` no dice qué hay dentro de `address`. Mismo argumento.
   *
   * `any` se traduce a `kind: 'scalar'` sin `scalarType`: es el
   * "cualquier cosa" del contrato, y JSON Schema lo pinta como `{}`
   * (matches all).
   */
  addFromSpec(spec: IValidationSpec): SchemaNodeId {
    this.checkOpen();
    switch (spec.type) {
      case "string":
      case "integer":
      case "number":
      case "boolean":
      case "date":
      case "datetime":
      case "file": {
        const id = this.newId("scalar");
        const constraints = constraintsFromValidationSpec(spec);
        const node = createScalarNode(spec.type, id, {
          ...(constraints !== undefined ? { constraints } : {}),
        });
        return this.add(node);
      }
      case "enum": {
        const id = this.newId("enum");
        const constraints = constraintsFromValidationSpec(spec);
        const node = createEnumNode(spec.enumValues ?? [], id, {
          ...(constraints !== undefined ? { constraints } : {}),
        });
        return this.add(node);
      }
      case "array": {
        // El item por defecto es un `string` opaco: la spec plana no
        // transporta el tipo del item.
        const itemId = this.add(createScalarNode("string", this.newId("scalar")));
        return this.addArray(itemId, spec.fieldName);
      }
      case "object": {
        return this.addObject(spec.fieldName, []);
      }
      case "any": {
        const id = this.newId("scalar");
        return this.add({ id, kind: "scalar" });
      }
    }
  }
}

/**
 * Construye un `SchemaGraph` mínimo a partir de `IValidationSpec[]`.
 *
 * El nodo raíz es un `object` con un hijo por spec. Cada spec se
 * traduce con `SchemaGraphBuilder.addFromSpec`. El grafo resultante
 * sirve para los exportadores que saben leerlo y, con `flatten-helper`,
 * para los que no.
 */
export function buildSchemaGraph(
  specs: ReadonlyArray<IValidationSpec>,
  options: IBuildOptions = {},
): ISchemaGraph {
  const builder = new SchemaGraphBuilder();
  const rootName = options.rootName ?? "Root";

  // Pasada 1: crear todos los nodos hoja. Si una spec es `array`, crea
  // dos nodos (el `array` y el `items` interno). Necesitamos los ids
  // antes de poder añadirlos como hijos del root, pero el builder ya
  // devuelve los ids al insertar, así que es lineal: primero nodos
  // independientes, luego se enchufan al root.
  const specIds = new Map<IValidationSpec, SchemaNodeId>();
  for (const spec of specs) {
    specIds.set(spec, builder.addFromSpec(spec));
  }

  // Pasada 2: crear el root y los hijos.
  const children: ISchemaEdge[] = [];
  for (const spec of specs) {
    const nodeId = specIds.get(spec);
    if (nodeId === undefined) continue;
    children.push({
      name: spec.fieldName,
      node: nodeId,
      required: spec.required,
    });
  }
  const rootId = builder.addObject(rootName, children);

  return builder.build(rootId);
}