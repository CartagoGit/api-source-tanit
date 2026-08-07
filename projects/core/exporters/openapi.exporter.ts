/**
 * Exportador a OpenAPI 3.1.0.
 *
 * Es el formato del lote que más lejos llega: de un OpenAPI salen SDKs,
 * configuración de gateway y documentación, y lo importan Swagger Editor,
 * Insomnia, Postman y casi cualquier cosa.
 *
 * **Se emite JSON, no YAML.** OpenAPI acepta los dos y las herramientas
 * también, así que la diferencia es de gusto — y emitir YAML exigiría
 * escribir un serializador a mano, con sus reglas de comillas y de
 * escapado. Un `descripción: sí` sin comillas es booleano en YAML 1.1, y
 * un fallo así corrompe el documento en silencio. No merece la pena
 * arriesgar la corrección del artefacto por la extensión del fichero.
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
} from "../contracts/export-target.interface.js";
import type { EndpointSpec, IEndpointField } from "../contracts/postman.interface.js";

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

function buildOperation(spec: EndpointSpec): Record<string, unknown> {
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
  if (bodyFields.length > 0) {
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

  // Sin esquema: no se sabe qué devuelve. Ver la cabecera del fichero.
  operation["responses"] = {
    "200": { description: "OK" },
  };
  return operation;
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

export class OpenApiExporter implements IExportTarget {
  readonly format = "openapi";
  readonly summary = "OpenAPI 3.1.0 (JSON) — SDKs, gateways, Swagger Editor";

  serialize(input: IExportInput): IExportArtifact[] {
    const { specs, config, auth } = input;

    // Un `path` de OpenAPI agrupa sus métodos: `/users` con `get` y
    // `post` es UNA entrada con dos operaciones, no dos entradas.
    const paths: Record<string, Record<string, unknown>> = {};
    for (const spec of specs) {
      const path = toOpenApiPath(spec.uri);
      const bucket = paths[path] ?? (paths[path] = {});
      bucket[spec.method.toLowerCase()] = buildOperation(spec);
    }

    const security = buildSecurity(auth);
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
      document["components"] = { securitySchemes: security.schemes };
      document["security"] = security.requirement;
    }

    return [
      {
        path: `${config.name}.openapi.json`,
        content: JSON.stringify(document, null, 2) + "\n",
      },
    ];
  }
}
