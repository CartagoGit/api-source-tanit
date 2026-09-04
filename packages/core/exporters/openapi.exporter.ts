/**
 * Exportador a OpenAPI 3.1.0.
 *
 * Es el formato del lote que más lejos llega: de un OpenAPI salen SDKs,
 * configuración de gateway y documentación, y lo importan Swagger Editor,
 * Insomnia, Postman y casi cualquier cosa.
 *
 * **Se emite YAML**, que es como se publica un OpenAPI casi siempre.
 *
 * Esto se hizo primero en JSON, por miedo a las reglas de escalares de
 * YAML: un `descripción: sí` sin comillas es un booleano, y un fallo así
 * corrompe el documento en silencio. La forma segura resultó ser
 * trivial —citar **toda** cadena— y vive en `yaml.helper.ts` con sus
 * tests, incluidos los valores que rompen un documento sin avisar. Con
 * eso el riesgo desaparece y no hay motivo para dar el formato que no se
 * pedía.
 *
 * Lo que **no** lleva es la parte de respuestas. Este proyecto escana lo
 * que la API **recibe**; lo que devuelve no está en ninguna señal que se
 * lea. Se emite un `200` con descripción y sin esquema, que es lo que
 * OpenAPI exige como mínimo, en vez de inventarse una forma de respuesta
 * que nadie ha comprobado.
 */
import type {
  IExportArtifact,
  IExportInput,
  IExportTarget,
} from "../../contracts/interfaces/core/export-target.interface.js";
import type { EndpointSpec, IEndpointField } from "../../contracts/interfaces/core/postman.interface.js";
import type {
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";
import { toYaml } from "../helpers/yaml.helper.js";
import type { YamlValue } from "../../contracts/interfaces/core/helpers.interface.js";

/** `{{id}}` de Postman → `{id}` de OpenAPI. */
function toOpenApiPath(uri: string): string {
  return uri.replace(/\{\{([^}]+)\}\}/g, "{$1}");
}

/** Los nombres de parámetro que lleva una ruta. */
function pathParamsOf(uri: string): string[] {
  return [...uri.matchAll(/\{\{([^}]+)\}\}/g)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined);
}

/** Tipo interno → tipo de JSON Schema. */
function toSchemaType(type: string): string {
  switch (type) {
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    // `enum` y `date` son cadenas con restricciones, no tipos de JSON
    // Schema: el formato y los valores van aparte.
    default:
      return "string";
  }
}

/** El esquema de un campo, con sus restricciones. */
function fieldSchema(field: IEndpointField): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: toSchemaType(field.type) };
  if (field.format) schema["format"] = field.format;
  if (field.enumValues && field.enumValues.length > 0) {
    schema["enum"] = [...field.enumValues];
  }
  if (field.minimum !== undefined) schema["minimum"] = field.minimum;
  if (field.maximum !== undefined) schema["maximum"] = field.maximum;
  if (field.minLength !== undefined) schema["minLength"] = field.minLength;
  if (field.maxLength !== undefined) schema["maxLength"] = field.maxLength;
  if (field.type === "array") schema["items"] = { type: "string" };
  return schema;
}

function buildOperation(spec: EndpointSpec, state: IBuildState): Record<string, unknown> {
  const fields = spec.fields ?? [];
  const operation: Record<string, unknown> = {
    summary: spec.name,
    operationId: `${spec.method.toLowerCase()}${toOpenApiPath(spec.uri)
      .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) =>
        c ? c.toUpperCase() : "",
      )}`,
  };
  if (spec.description) operation["description"] = spec.description;

  // Parámetros: los de la ruta salen de la propia URI (siempre
  // obligatorios, lo dice la especificación), y los de query y cabecera
  // de las reglas de validación.
  const parameters: Array<Record<string, unknown>> = [];
  for (const name of pathParamsOf(spec.uri)) {
    const declared = fields.find((f) => f.location === "path" && f.fieldName === name);
    parameters.push({
      name,
      in: "path",
      required: true,
      schema: declared ? fieldSchema(declared) : { type: "string" },
    });
  }
  for (const field of fields) {
    if (field.location !== "query" && field.location !== "header") continue;
    parameters.push({
      name: field.fieldName,
      in: field.location,
      required: field.required,
      schema: fieldSchema(field),
    });
  }
  // Cabeceras declaradas que no vienen de una regla (las de un spec
  // OpenAPI original, por ejemplo).
  for (const header of spec.headers ?? []) {
    if (parameters.some((p) => p["name"] === header.key && p["in"] === "header")) continue;
    parameters.push({
      name: header.key,
      in: "header",
      required: false,
      schema: { type: "string" },
      ...(header.description ? { description: header.description } : {}),
    });
  }
  if (parameters.length > 0) operation["parameters"] = parameters;

  const bodyFields = fields.filter((f) => f.location === "body");
  if (spec.schemaGraph) {
    // Camino rico: si el scanner declaró un `SchemaGraph`, lo usamos
    // para el body. Es lo que permite anidar objetos, representar
    // arrays de objetos y uniones — la lista plana `fields` no puede.
    const { schema, components } = emitSchemaGraph(
      spec.schemaGraph,
      spec.schemaGraph.root,
    );
    // Acumulamos los `components` declarados por este endpoint; el
    // llamador los mezcla con los de los demás y los mueve bajo
    // `components.schemas` antes de cerrar el documento.
    for (const [name, body] of Object.entries(components)) {
      state.components[name] = body;
    }
    operation["requestBody"] = {
      required: bodyFields.some((f) => f.required),
      content: {
        "application/json": {
          schema,
          ...(spec.body !== undefined ? { example: spec.body } : {}),
        },
      },
    };
  } else if (bodyFields.length > 0) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const field of bodyFields) {
      properties[field.fieldName] = fieldSchema(field);
      if (field.required) required.push(field.fieldName);
    }
    operation["requestBody"] = {
      required: required.length > 0,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
          ...(spec.body !== undefined ? { example: spec.body } : {}),
        },
      },
    };
  } else if (spec.body !== undefined) {
    // Hay ejemplo pero no reglas: se emite el ejemplo sin esquema, que es
    // más honesto que deducir tipos de un JSON de muestra.
    operation["requestBody"] = {
      required: false,
      content: { "application/json": { example: spec.body } },
    };
  }

  // Audit 2026-09-04 P1 #7: auth:none por operación se respeta en el
  // documento OpenAPI. El esquema global define `security` a nivel
  // de documento (`document.security = [{ bearerAuth: [] }]`), pero
  // OpenAPI permite sobrescribirlo por operación con `security: []`
  // (array vacío) — eso significa "este endpoint es público, no
  // requiere ningún esquema de seguridad". Sin este override, un
  // `/auth/login` se exportaba con `Authorization: Bearer` y la
  // primera request devolvía 401.
  if (spec.auth?.kind === "none") {
    operation["security"] = [];
  }

  // Sin esquema: no se sabe qué devuelve. Ver la cabecera del fichero.
  operation["responses"] = {
    "200": { description: "OK" },
  };
  return operation;
}

/**
 * Estado mutable que atraviesa todos los `buildOperation`.
 *
 * Hoy solo lleva `components` (los `$ref` que el `SchemaGraph` declara);
 * mañana podría llevar, p. ej., un `visited` global si dos endpoints
 * comparten un nodo por id y queremos deduplicarlo.
 */
interface IBuildState {
  /**
   * Acumulador de `components` por endpoint. Cada endpoint que tenga
   * un `SchemaGraph` con nodos nombrados añade entradas aquí; al
   * cerrar el documento se mueven bajo `components.schemas` (la forma
   * que OpenAPI espera) y se mezclan con `securitySchemes`.
   */
  readonly components: Record<string, Record<string, unknown>>;
}

/**
 * Traduce un `SchemaGraph` a un esquema JSON Schema válido en OpenAPI 3.1.
 *
 * El emisor hace dos pasadas:
 *
 *   1. Pre-registra todos los nodos con `name` como entradas vacías en
 *      `components`, para que las referencias adelantadas (`A → B`
 *      donde `B` se declara después) resuelvan en el documento final.
 *   2. Emite cada nodo nombrado y luego el root. Los `$ref` se
 *      resuelven contra `components` por `name`; los nodos sin nombre
 *      se inlinean.
 *
 * Los ciclos sin nombre (p. ej. una `union` cuyo `alternative` es
 * directamente el propio nodo) se cortan devolviendo `{}`: no hay forma
 * de $ref-enciar a un nodo anónimo y emitirlo en línea reentraría
 * infinitamente. `{}` en JSON Schema significa "matches anything", que
 * es lo más cercano a "esta parte del grafo es recursiva y la
 * renunciamos a pintarla".
 */
function emitSchemaGraph(
  graph: ISchemaGraph,
  rootId: SchemaNodeId,
): { schema: Record<string, unknown>; components: Record<string, Record<string, unknown>> } {
  const components: Record<string, Record<string, unknown>> = {};
  const visiting = new Set<SchemaNodeId>();
  const state = { components, visiting };

  // Pasada 1: placeholders. Hacen que las refs a nodos nombrados
  // resuelvan aunque todavía no hemos emitido el cuerpo del nodo.
  for (const [, node] of graph.nodes) {
    if (node.name && !(node.name in components)) {
      components[node.name] = {};
    }
  }
  // Pasada 2: emitir cada nodo nombrado sobre el placeholder.
  for (const [, node] of graph.nodes) {
    if (!node.name) continue;
    visiting.add(node.id);
    try {
      components[node.name] = emitSchemaNode(graph, node, state);
    } finally {
      visiting.delete(node.id);
    }
  }

  // Pasada 3: el root. Se inlinea **siempre**: el `requestBody` del
  // endpoint lleva la forma del body, no un puntero a un componente
  // (un `$ref`根部 serviría si quisiéramos reusar la raíz desde varios
  // endpoints, pero un body por endpoint es lo normal y un `$ref`
  // aquí solo añadiría ruido). Los hijos con `name` siguen yendo a
  // `components.schemas` y se referencian desde dentro.
  //
  // NO añadimos `rootId` a `visiting` antes de emitir: el guard de
  // ciclos al inicio de `emitSchemaNode` miraría la presencia y, al
  // ser el root anónimo, saldría con `{}`. La detección de ciclos solo
  // tiene que activarse cuando **re-entramos** en un nodo dentro de la
  // recursión, no al arrancar la primera llamada.
  const root = graph.nodes.get(rootId);
  if (!root) return { schema: {}, components };
  const schema = emitSchemaNode(graph, root, state);
  return { schema, components };
}

/** Despacha por `kind` para emitir el nodo como JSON Schema. */
function emitSchemaNode(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  // Corte de ciclo para nodos sin nombre: sin un nombre al que $ref,
  // inlinearlo reentraría. `{}` (matches all) es la salida más honesta.
  if (state.visiting.has(node.id) && !node.name) return {};

  switch (node.kind) {
    case "scalar":
      return emitScalarSchema(node);
    case "enum":
      return { type: "string", enum: node.enumValues ? [...node.enumValues] : [] };
    case "literal":
      return { const: node.literal };
    case "object":
      return emitObjectSchema(graph, node, state);
    case "array":
      return emitArraySchema(graph, node, state);
    case "tuple":
      return emitTupleSchema(graph, node, state);
    case "union":
      return {
        oneOf: (node.alternatives ?? []).map((alt) =>
          emitFromId(graph, alt, state),
        ),
      };
    case "intersection":
      return {
        allOf: (node.alternatives ?? []).map((alt) =>
          emitFromId(graph, alt, state),
        ),
      };
    case "reference": {
      const target = node.ref ? graph.nodes.get(node.ref) : undefined;
      if (!target) return {};
      if (target.name) {
        return { $ref: `#/components/schemas/${target.name}` };
      }
      return emitSchemaNode(graph, target, state);
    }
    case "nullable": {
      // OpenAPI 3.1 usa JSON Schema 2020-12: `nullable: true` está
      // deprecado. La nulabilidad se modela con `type: [T, "null"]`
      // cuando el inner tiene un `type` escalar (string/number/etc.,
      // incluido object y array — JSON Schema 2020-12 acepta arrays
      // de tipos para todas las clases), o `oneOf: [T, { type: "null" }]`
      // cuando no lo tiene (unions, references con `$ref`). Si el
      // `inner` falta (grafo incompleto), emitimos `{ type: "null" }`
      // — el fallback vive dentro de `emitNullable`.
      return emitNullable(graph, node, state);
    }
  }
}

/** Resuelve un id y emite su nodo. Helper para no repetir `graph.nodes.get`. */
function emitFromId(
  graph: ISchemaGraph,
  id: SchemaNodeId,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  const node = graph.nodes.get(id);
  if (!node) return {};
  return emitSchemaNode(graph, node, state);
}

/**
 * Decide cómo emitir un nodo en posición de **hijo** (campo de objeto,
 * item de array, etc.).
 *
 * Distinto del root, que siempre se inlinea: el body del endpoint
 * lleva la forma del body, no un puntero a un componente. Aquí, en
 * cambio, lo normal es que el hijo sea un tipo reusado y se prefiera
 * `$ref` a inline (reuso es lo que hace `components` valioso).
 *
 * Las referencias son el caso especial: si el hijo es un nodo
 * `reference`, miramos el **target** para decidir. Si el target tiene
 * nombre, `$ref`; si no, lo inlineamos.
 */
function emitChild(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  if (node.kind === "reference") {
    const target = node.ref ? graph.nodes.get(node.ref) : undefined;
    if (!target) return {};
    if (target.name) {
      return { $ref: `#/components/schemas/${target.name}` };
    }
    return emitSchemaNode(graph, target, state);
  }
  if (node.name) {
    return { $ref: `#/components/schemas/${node.name}` };
  }
  return emitSchemaNode(graph, node, state);
}

/** Emite un `object` como `{ type: "object", properties, required }`. */
function emitObjectSchema(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const edge of node.children ?? []) {
    const child = graph.nodes.get(edge.node);
    if (!child) continue;
    properties[edge.name] = emitChild(graph, child, state);
    if (edge.required) required.push(edge.name);
  }
  const out: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) out["required"] = required;
  return out;
}

/** Emite un `array` como `{ type: "array", items }`. */
function emitArraySchema(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  const itemEdge = (node.children ?? [])[0];
  if (!itemEdge) return { type: "array", items: {} };
  const item = graph.nodes.get(itemEdge.node);
  if (!item) return { type: "array", items: {} };
  const items = emitChild(graph, item, state);
  return { type: "array", items };
}

/** Emite una `tuple` como `{ type: "array", prefixItems }` (OpenAPI 3.1 = JSON Schema 2020-12). */
function emitTupleSchema(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  const prefixItems: Array<Record<string, unknown>> = (node.children ?? []).map(
    (edge) => {
      const child = graph.nodes.get(edge.node);
      if (!child) return {};
      return emitChild(graph, child, state);
    },
  );
  return { type: "array", prefixItems };
}

/** Emite un `scalar` con sus constraints como `{ type, format, minimum, ... }`. */
function emitScalarSchema(node: ISchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = { type: node.scalarType ?? "string" };
  const c = node.constraints;
  if (!c) return out;
  if (c.format !== undefined) out["format"] = c.format;
  if (c.minimum !== undefined) out["minimum"] = c.minimum;
  if (c.maximum !== undefined) out["maximum"] = c.maximum;
  if (c.minLength !== undefined) out["minLength"] = c.minLength;
  if (c.maxLength !== undefined) out["maxLength"] = c.maxLength;
  if (c.pattern !== undefined) out["pattern"] = c.pattern;
  return out;
}

/**
 * Emite un nodo `nullable` como composición válida en OpenAPI 3.1.
 *
 * OpenAPI 3.1 adopta JSON Schema 2020-12 y elimina `nullable: true`.
 * La nulabilidad se modela así:
 *
 *   - **Escalares** (`scalar`/`enum`/`literal`): `type: [T, "null"]`
 *     — la forma más compacta y fiel a la intención.
 *   - **Compuestos** (`object`/`array`/`union`/`intersection`):
 *     `oneOf: [{...inner}, { type: "null" }]` — aquí el `type` no
 *     admite array, así que pasamos por composición.
 *   - **References**: el `$ref` también puede envolverse en
 *     `oneOf: [{$ref}, { type: "null" }]`; el formato 3.1 lo permite.
 *
 * Si el inner no resuelve a nada (grafo incompleto), devolvemos
 * `{ type: "null" }`: "esto puede ser null, nada más" es lo más
 * honesto que podemos decir sin inventar.
 */
function emitNullable(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  const inner = node.inner ? emitFromId(graph, node.inner, state) : {};
  // Si el inner no resuelve a nada (grafo incompleto), caemos a
  // `{ type: "null" }`: "esto puede ser null, nada más" es lo más
  // honesto que podemos decir sin inventar.
  if (Object.keys(inner).length === 0) {
    return { type: "null" };
  }
  // Si el inner tiene un `type` escalar (string, number, object,
  // array, …), la nulabilidad va como `type: [T, "null"]`. JSON
  // Schema 2020-12 (y por tanto OpenAPI 3.1) admite esto para
  // cualquier `type`, no solo los escalares en sentido estricto.
  const innerType = inner["type"];
  if (typeof innerType === "string") {
    return { ...inner, type: [innerType, "null"] };
  }
  // El inner no tiene `type` propio (es un `oneOf`/`allOf`/`$ref`):
  // pasamos a composición explícita.
  return { oneOf: [inner, { type: "null" }] };
}

/** El bloque `securitySchemes`, derivado de lo ya detectado. */
function buildSecurity(auth: IExportInput["auth"]): {
  schemes: Record<string, unknown>;
  requirement: Array<Record<string, string[]>>;
} {
  switch (auth.type) {
    case "bearer":
      return {
        schemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
        requirement: [{ bearerAuth: [] }],
      };
    case "apikey":
      return {
        schemes: {
          apiKeyAuth: {
            type: "apiKey",
            name: auth.keyName ?? "X-API-Key",
            in: auth.keyIn ?? "header",
          },
        },
        requirement: [{ apiKeyAuth: [] }],
      };
    case "oauth2":
      return {
        schemes: {
          oauth2Auth: {
            type: "oauth2",
            flows: { clientCredentials: { tokenUrl: "/oauth/token", scopes: {} } },
          },
        },
        requirement: [{ oauth2Auth: [] }],
      };
    case "none":
      return { schemes: {}, requirement: [] };
  }
}

/**
 * El documento OpenAPI como objeto, antes de serializarlo.
 *
 * Se exporta para poder comprobar su **estructura** con aserciones
 * precisas en vez de buscando subcadenas en un YAML. Que el YAML sea
 * correcto es otro problema, y lo cubre `yaml.helper.spec.ts`.
 */
export function buildOpenApiDocument(input: IExportInput): Record<string, unknown> {
  const { specs, config, auth } = input;

    // `components` se rellena sobre la marcha con los `$ref` que los
    // endpoints declaran en su `SchemaGraph`. Si nadie declara nada,
    // queda vacío y `document.components` no aparece — preserva el
    // comportamiento previo, donde `components` solo existía si había
    // `securitySchemes`.
    const state: IBuildState = { components: {} };

    // Un `path` de OpenAPI agrupa sus métodos: `/users` con `get` y
    // `post` es UNA entrada con dos operaciones, no dos entradas.
    const paths: Record<string, Record<string, unknown>> = {};
    for (const spec of specs) {
      const path = toOpenApiPath(spec.uri);
      const bucket = paths[path] ?? (paths[path] = {});
      // La **primera** gana, para que coincida con lo que dice el aviso.
      // Con `=` a secas ganaba la última, y el aviso mentía sobre cuál
      // se había conservado.
      const verb = spec.method.toLowerCase();
      if (!(verb in bucket)) bucket[verb] = buildOperation(spec, state);
    }

    const security = buildSecurity(auth);
    if (Object.keys(security.schemes).length > 0) {
      state.components["securitySchemes"] = security.schemes;
    }

    // OpenAPI 3.1 separa `components.schemas` (los tipos reutilizables
    // declarados por el `SchemaGraph`) de `components.securitySchemes`
    // (el bloque de auth). Si hay `components` acumulados, los movemos
    // bajo `schemas` y dejamos `securitySchemes` a nivel de `components`.
    const document: Record<string, unknown> = {
      openapi: "3.1.0",
      info: {
        title: config.collectionName || config.name,
        description: config.collectionDescription || "",
        version: "1.0.0",
      },
      servers: [{ url: config.baseUrl }],
      paths,
    };
    if (Object.keys(security.schemes).length > 0) {
      document["security"] = security.requirement;
    }
    if (Object.keys(state.components).length > 0) {
      const { securitySchemes, ...schemas } = state.components;
      const components: Record<string, unknown> = {};
      if (Object.keys(schemas).length > 0) {
        components["schemas"] = schemas;
      }
      if (securitySchemes !== undefined) {
        components["securitySchemes"] = securitySchemes;
      }
      document["components"] = components;
    }

  return document;
}

/** Serializa el catálogo a un documento OpenAPI 3.1.0 en YAML. */
export class OpenApiExporter implements IExportTarget {
  readonly format = "openapi";
  readonly summary = "OpenAPI 3.1.0 (YAML) — SDKs, gateways, Swagger Editor";

  /**
   * Operaciones que se pierden por la forma del formato.
   *
   * OpenAPI indexa por ruta + método, así que dos endpoints que
   * comparten los dos son **el mismo** para el documento. En REST no
   * pasa; en RPC sobre POST —GraphQL, tRPC con un solo endpoint— es la
   * norma.
   */
  warnings(input: IExportInput): string[] {
    const byKey = new Map<string, string[]>();
    for (const spec of input.specs) {
      const key = `${spec.method} ${toOpenApiPath(spec.uri)}`;
      byKey.set(key, [...(byKey.get(key) ?? []), spec.name]);
    }
    const out: string[] = [];
    for (const [key, names] of byKey) {
      if (names.length < 2) continue;
      out.push(
        `openapi: \`${key}\` agrupa ${names.length} operaciones y el formato solo ` +
          `admite una. Se conserva \`${names[0]}\` y se pierden: ` +
          `${names.slice(1).join(", ")}. OpenAPI identifica una operación por ruta ` +
          "y método, así que una API de RPC sobre POST no se puede representar entera.",
      );
    }
    return out;
  }

  serialize(input: IExportInput): IExportArtifact[] {
    return [
      {
        path: `${input.config.name}.openapi.yaml`,
        content: toYaml(buildOpenApiDocument(input) as YamlValue),
      },
    ];
  }
}
