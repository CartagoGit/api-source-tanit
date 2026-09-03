/**
 * El modelo intermedio (IR) de tipos: `SchemaGraph`.
 *
 * Hasta ahora el IR era una **lista plana de campos** (`EndpointSpec.fields:
 * IEndpointField[]`). Eso sirve para describir reglas de validación sueltas,
 * pero no tipos anidados: un `address: { street, city }` se aplana a
 * `address.street` y `address.city`, los `enum` se pierden si no están
 * declarados como `enumValues`, y un `oneOf` o un `$ref` ni siquiera
 * existen como concepto.
 *
 * `SchemaGraph` introduce un nivel de indirección: los scanners pueden
 * declarar **un grafo de nodos** y referenciarse entre ellos. Los
 * exportadores que saben consumir el grafo (OpenAPI por ahora) producen
 * documentos fieles; los que aún trabajan con la lista plana tienen un
 * `flatten-helper` que se la reconstruye.
 *
 * ## Forma
 *
 * El grafo es:
 *
 *   - `nodes`: un `Map<SchemaNodeId, ISchemaNode>` con todos los nodos,
 *     accesibles por id estable.
 *   - `root`: el id del nodo raíz del que cuelga la request del endpoint.
 *
 * Cada nodo declara su `kind` (uno de los `SchemaNodeKind`). El resto de
 * campos son **opcionales según el kind**: un `scalar` lleva `scalarType`,
 * un `enum` lleva `enumValues`, un `object` lleva `children`, etc. Mezclar
 * campos irrelevantes para el kind no aporta información y queda fuera del
 * contrato — los helpers de este paquete solo rellenan los que aplican.
 *
 * ## Recursión y referencias
 *
 * La recursión se modela con un nodo `reference` cuyo `ref` apunta a otro
 * nodo **del mismo grafo**. La resolución es local primero: si el grafo
 * no contiene el destino, el nodo queda como `$ref` sin resolver y es
 * responsabilidad del exportador decidir qué hacer (los scanners que
 * detectan `OpenAPI`/`components/schemas` lo resolverán contra el
 * documento original; los demás emitirán el `$ref` literal). Network
 * opcional queda fuera del scope actual (a00010 S6).
 *
 * ## Por qué `ReadonlyMap` / `ReadonlyArray`
 *
 * El grafo se construye una vez y se lee muchas. Marcarlo inmutable desde
 * el contrato evita que un exportador lo mutara por descuido, y le da al
 * compilador pie a optimizaciones.
 */

import type { IEndpointField } from "./postman.interface.js";

/** Tipos de nodo del grafo. */
export type SchemaNodeKind =
  | "scalar"
  | "enum"
  | "object"
  | "array"
  | "tuple"
  | "union"
  | "intersection"
  | "reference"
  | "literal"
  | "nullable";

/** Localizador estable de un nodo dentro del grafo. */
export type SchemaNodeId = string;

/** Restricciones aplicables a un nodo (no anulan el `kind`, lo decoran). */
export interface ISchemaConstraints {
  readonly format?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

/**
 * Un nodo del grafo.
 *
 * El campo que aplica depende de `kind`:
 *
 *   - `scalar`     → `scalarType`
 *   - `enum`       → `enumValues`
 *   - `literal`    → `literal`
 *   - `object`     → `children`
 *   - `array`      → `children` (un único item, `name` suele ser `items`)
 *   - `tuple`      → `children` (posicionales, `name` lleva el índice)
 *   - `union`      → `alternatives`
 *   - `intersection` → `alternatives`
 *   - `reference`  → `ref`
 *   - `nullable`   → `inner`
 *
 * `constraints` es ortogonal al `kind`: lo admiten todos los nodos y se
 * traduce a las claves equivalentes en JSON Schema (`format`, `minimum`,
 * `pattern`, …).
 */
export interface ISchemaNode {
  readonly id: SchemaNodeId;
  readonly kind: SchemaNodeKind;
  /** Nombre lógico (ej. `User`, `UserCreate`). Si está, los exportadores lo registran como `$ref`. */
  readonly name?: string;
  /** Tipo escalar — solo si `kind === 'scalar'`. */
  readonly scalarType?: "string" | "integer" | "number" | "boolean" | "date" | "datetime" | "file";
  /** Valores permitidos — solo si `kind === 'enum'`. */
  readonly enumValues?: ReadonlyArray<string>;
  /** Valor literal — solo si `kind === 'literal'`. */
  readonly literal?: unknown;
  /** Hijos (campos del objeto, items del array, etc.). */
  readonly children?: ReadonlyArray<ISchemaEdge>;
  /** Id del nodo referenciado — solo si `kind === 'reference'`. */
  readonly ref?: SchemaNodeId;
  /** Nodos alternativos — solo si `kind === 'union'` o `intersection'`. */
  readonly alternatives?: ReadonlyArray<SchemaNodeId>;
  /** Restricciones adicionales (format, min/max, pattern). */
  readonly constraints?: ISchemaConstraints;
  /** Nodo envuelto — solo si `kind === 'nullable'`. */
  readonly inner?: SchemaNodeId;
}

/** Una arista con nombre: campo de objeto, item de array, etc. */
export interface ISchemaEdge {
  readonly name: string;
  readonly node: SchemaNodeId;
  readonly required?: boolean;
  readonly description?: string;
}

/**
 * El grafo completo.
 *
 * Los ids son **estables por construcción**: una vez publicado un grafo,
 * dos llamadas que partan de las mismas specs producen el mismo mapa de
 * nodos. Eso permite que los exportadores cacheen resultados por
 * `SchemaNodeId` y que los diffs entre dos pasadas sean estables.
 */
export interface ISchemaGraph {
  readonly nodes: ReadonlyMap<SchemaNodeId, ISchemaNode>;
  /** El id del nodo raíz del grafo. */
  readonly root: SchemaNodeId;
}

/**
 * Cómo un endpoint usa un grafo de schemas.
 *
 * No se adjunta aún a `EndpointSpec` (a00010 S6 deja solo `schemaGraph`
 * opcional, con `root` como punto de partida). El tipo queda declarado
 * para los exportadores que necesiten más de un nodo por endpoint — el
 * caso obvio es OpenAPI, donde las responses también se describen: cada
 * código de estado se asocia a un nodo del grafo por id.
 */
export interface IOperationSchema {
  readonly request?: SchemaNodeId;
  readonly responses?: ReadonlyMap<string, SchemaNodeId>;
}

/**
 * Forma aplanada de un nodo, lista para exportarse a un formato que aún
 * no consume `SchemaGraph` (la colección Postman, por ejemplo).
 *
 * Es lo que devuelve `flatten-helper`: un walk desde la raíz que emite
 * un `IEndpointField` por cada nodo escalable. Los nodos `object` se
 * recorren recursivamente; las tuplas y uniones se aplanan con sufijos
 * en el nombre (`<campo>.0`, `<campo>.<alternativa>`).
 */
export interface IFlattenedField {
  readonly path: string;
  readonly nodeId: SchemaNodeId;
  readonly kind: SchemaNodeKind;
  readonly field: IEndpointField;
}

export interface IBuildOptions {
  /** Nombre lógico del nodo raíz. Si se omite, `"Root"`. */
  readonly rootName?: string;
}

/** Tipo escalar que el contrato acepta como `scalarType`. */
export type ScalarType = NonNullable<ISchemaNode["scalarType"]>;

/** Opciones al construir un nodo `scalar` o `enum`. */
export interface IScalarOptions {
  /** Restricciones adicionales: format, min/max, pattern, etc. */
  readonly constraints?: ISchemaConstraints;
  /** Nombre lógico (ej. `UserId`). Lo recogen los exportadores como `$ref`. */
  readonly name?: string;
}

/** Opciones comunes a los nodos compuestos (`union`/`intersection`/`object`/`array`). */
export interface ICompositeOptions {
  /** Nombre lógico (ej. `UserOrError`). Lo usan los exportadores como `$ref`. */
  readonly name?: string;
  /** Restricciones adicionales aplicables al nodo compuesto. */
  readonly constraints?: ISchemaConstraints;
}

/** Opciones al construir un nodo `reference`. */
export interface IReferenceOptions {
  /** Nombre del nodo referencia (si lo tiene; los `$ref` nominales lo usan). */
  readonly name?: string;
  /** Descripción opcional del enlace. */
  readonly description?: string;
}

/** Opciones para los constructores de nodos compuestos (`object`/`array`/`tuple`). */
export interface ICompositeNodeOptions extends ICompositeOptions {}
/** Opciones al construir un nodo `scalar` o `enum`. */
export interface IScalarOptions {
  /** Restricciones adicionales: format, min/max, pattern, etc. */
  readonly constraints?: ISchemaConstraints;
  /** Nombre lógico (ej. `UserId`). Lo recogen los exportadores como `$ref`. */
  readonly name?: string;
}

/** Opciones comunes a los nodos compuestos (`union`, `intersection`, `object`, `array`). */
export interface ICompositeOptions {
  /** Nombre lógico (ej. `UserOrError`). Lo usan los exportadores como `$ref`. */
  readonly name?: string;
  /** Restricciones adicionales aplicables al nodo compuesto. */
  readonly constraints?: ISchemaConstraints;
}

/** Opciones al construir un nodo `reference`. */
export interface IReferenceOptions {
  /** Nombre del nodo referencia (si lo tiene; los `$ref` nominales lo usan). */
  readonly name?: string;
  /** Descripción opcional del enlace. */
  readonly description?: string;
}

/** Opciones para los constructores de nodos compuestos (`object`/`array`/`tuple`). */
export interface ICompositeNodeOptions extends ICompositeOptions {}
