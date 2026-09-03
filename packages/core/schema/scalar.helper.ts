/**
 * Constructores de nodos escalares del `SchemaGraph`.
 *
 * Tres tipos de nodo entran en este fichero:
 *
 *   - `scalar` — un valor primitivo (`string`, `integer`, …).
 *   - `enum`   — un valor de un conjunto finito y declarado.
 *   - `literal` — un valor constante, declarado por su valor.
 *
 * Son los nodos "hoja": no tienen hijos ni referencias. El resto del
 * grafo (`object`, `array`, `union`, …) se construye en
 * `build-schema-graph.helper.ts` con un builder, porque necesitan
 * registrar ids y mantener un mapa de nodos en construcción.
 *
 * Las funciones son **puras**: dado el mismo input devuelven el mismo
 * nodo. Eso permite que el builder ensaye ids candidatos antes de
 * fijarlos, y que los tests comparen grafos por igualdad estructural.
 */
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  IScalarOptions,
  ISchemaConstraints,
  ISchemaNode,
  ScalarType,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";

/** Tipo escalar que el contrato acepta como `scalarType`. */
export type { ScalarType };

/**
 * Construye un nodo `scalar`.
 *
 * El id lo pasa el caller: normalmente viene del `SchemaGraphBuilder`,
 * que mantiene el registro único de nodos. Pasar ids externos al
 * builder produciría colisiones silenciosas.
 */
export function createScalarNode(
  scalarType: ScalarType,
  id: SchemaNodeId,
  options: IScalarOptions = {},
): ISchemaNode {
  return {
    id,
    kind: "scalar",
    scalarType,
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
  };
}

/**
 * Construye un nodo `enum`.
 *
 * `values` no se valida aquí: el caller sabe lo que está declarando, y
 * una lista vacía es un caso real (un `enum` declarado en el código
 * que el scanner no ha sabido poblar). Lo que sí se congela es la
 * referencia: un `enum` no debería mutar tras construirse.
 */
export function createEnumNode(
  values: ReadonlyArray<string>,
  id: SchemaNodeId,
  options: IScalarOptions = {},
): ISchemaNode {
  return {
    id,
    kind: "enum",
    enumValues: [...values],
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
  };
}

/**
 * Construye un nodo `literal`.
 *
 * `literal` es `unknown` porque admite cualquier valor JSON primitivo:
 * un `42`, un `"foo"`, un `true`, un `null`. Lo que el exportador hace
 * con él depende del formato destino: JSON Schema lo pinta como
 * `{ const: <valor> }`.
 */
export function createLiteralNode(
  literal: unknown,
  id: SchemaNodeId,
): ISchemaNode {
  return { id, kind: "literal", literal };
}

/**
 * Traduce las restricciones de un `IValidationSpec` a `ISchemaConstraints`.
 *
 * Las restricciones viven **fuera del nodo**: un nodo `scalar` lleva su
 * tipo (`string`, `integer`…) y este objeto lleva los adornos
 * (`format`, `minimum`, `pattern`…). Separarlas deja claro que son
 * ortogonales y que `flatten-helper` puede tratar los constraints como
 * metadato sin tener que recorrerse el grafo.
 *
 * Devuelve `undefined` si no hay ninguna restricción: el `ISchemaNode`
 * distingue entre "no tiene constraints" y "tiene constraints vacíos",
 * y aquí respetamos esa distinción.
 */
export function constraintsFromValidationSpec(
  spec: IValidationSpec,
): ISchemaConstraints | undefined {
  const out: { -readonly [K in keyof ISchemaConstraints]: ISchemaConstraints[K] } = {};
  if (spec.format !== undefined) out["format"] = spec.format;
  if (spec.minimum !== undefined) out["minimum"] = spec.minimum;
  if (spec.maximum !== undefined) out["maximum"] = spec.maximum;
  if (spec.minLength !== undefined) out["minLength"] = spec.minLength;
  if (spec.maxLength !== undefined) out["maxLength"] = spec.maxLength;
  if (spec.pattern !== undefined) out["pattern"] = spec.pattern;
  return Object.keys(out).length > 0 ? out : undefined;
}