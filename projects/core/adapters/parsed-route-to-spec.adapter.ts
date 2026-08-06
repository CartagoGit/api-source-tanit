/**
 * Adapter universal: `ParsedRoute` (neutro) → `EndpointSpec` (Postman).
 *
 * Acepta una `IRouteScanner` (cualquier framework) y un
 * `IValidationSpecProvider` opcional, y devuelve la misma forma
 * que `endpoint-discovery.service.ts > discoverEndpoints()`:
 *
 *   {
 *     specs: EndpointSpec[],
 *     routes: ParsedRoute[],
 *     withFormRequest: number,
 *     withoutFormRequest: number,
 *   }
 *
 * Lo que este adapter NO hace (deliberadamente):
 *   - No asigna `folder` automáticamente (lo calcula collection-builder).
 *   - No infiere body/query heurísticos (eso es `param-inferrer.service.ts`
 *     y se aplica aparte en el script `generate`).
 *   - No enriquece con variantes (eso es `catalog-enricher.service.ts`).
 *
 * El `formRequest` del `EndpointSpec` se setea al FQCN (o path) que el
 * `IValidationSpecProvider` haya resuelto, como string identificador.
 * El enricher lo usará para cargar reglas adicionales.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EndpointSpec } from "../contracts/postman.interface.js";
import type {
  IProjectMatch,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../contracts/scanner.interface.js";

/** Convierte `{x}` o `:x` (Express) a `{{x}}`. La URI ya viene con
 * prefix aplicado desde el scanner; aquí solo normalizamos el formato
 * canónico Postman (`{{param}}` y `/` inicial). */
export function toPostmanUri(laravelUri: string): string {
  let u = laravelUri.trim();
  // Paso 1: `<int:id>`, `<str:slug>`, `<id>` (Django) → `{{id}}`.
  //         DEBE ir antes que `:param` para evitar que `<int:id>` se
  //         rompa en `<int{{id}}>` (porque `:id` matchearía `:param`).
  u = u.replace(/<[a-zA-Z_][\w]*:([a-zA-Z_][\w]*)>/g, "{{$1}}");
  u = u.replace(/<([a-zA-Z_][\w]*)>/g, "{{$1}}");
  // Paso 2: `:param` (Express) → `{{param}}`.
  u = u.replace(/:([a-zA-Z_][\w]*)/g, "{{$1}}");
  // Paso 3: `{param}` (Laravel) → `{{param}}`. Lookbehind negativo para
  // NO matchear si el `{` va precedido de otro `{` (eso es `{{param}}`).
  u = u.replace(/(?<!\{)\{([a-zA-Z_][\w]*)\}(?!\})/g, "{{$1}}");
  // Nota: NO quitamos prefijos `api/vN/` automáticamente. El prefix real
  // del backend depende del framework:
  //   - Laravel: RouteServiceProvider quita `api/` → collection va sin él.
  //   - ASP.NET, Spring Boot, Gin, NestJS: el prefix es real → se conserva.
  // El scanner debe emitir la URI TAL COMO debe aparecer en Postman.
  if (!u.startsWith("/")) u = "/" + u;
  u = u.replace(/\/+/g, "/");
  // La barra final se CONSERVA: en Django (`APPEND_SLASH = True`, que es
  // el defecto) `/users` redirige 301 a `/users/`, y un POST pierde el
  // body en la redirección. Es responsabilidad del scanner emitir la URI
  // tal como debe llamarse.
  return u;
}

/** Deriva un nombre legible a partir del método HTTP + URI. */
function deriveName(route: ParsedRoute): string {
  if (route.displayName) return toPostmanUri(route.displayName);
  // Normalizar la URI para displayName (e.g. `<int:id>` → `{{id}}`,
  // `:id` → `{{id}}`).
  const uri = toPostmanUri(route.uri);
  // El nombre acaba en la UI de Postman, así que va en inglés: lo usa
  // gente de cualquier país.
  const segs = uri
    .split("/")
    .filter((s) => s && !s.startsWith("{{"));
  const last = segs[segs.length - 1] ?? "";
  const capitalize = (s: string) =>
    s
      .split(/[-_]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  const verbMap: Record<string, string> = {
    GET: "Get",
    POST: "Create",
    PUT: "Update",
    PATCH: "Patch",
    DELETE: "Delete",
  };
  const verb = verbMap[route.method.toUpperCase()] ?? route.method.toUpperCase();
  if (last) return `${verb} ${capitalize(last)}`;
  return `${verb} ${route.uri}`;
}

function exampleValueForField(spec: IValidationSpec): unknown {
  const { fieldName, type, enumValues, format, location } = spec;
  if (enumValues && enumValues.length > 0) return enumValues[0];
  // Headers comunes: placeholders útiles.
  if (location === "header") {
    const low = fieldName.toLowerCase();
    if (low === "authorization" || low.endsWith("-token")) return "{{token}}";
    if (low === "x-api-key" || low.endsWith("-api-key") || low.endsWith("-key")) {
      return "your-api-key-here";
    }
    if (low === "accept") return "application/json";
    if (low === "content-type") return "application/json";
    if (low === "user-agent" || low === "x-request-id") return "demo-123";
  }
  switch (type) {
    case "string":
      if (format === "email") return "user@example.com";
      if (format === "url") return "https://example.com";
      if (format === "uuid") return "00000000-0000-0000-0000-000000000001";
      return `sample_${fieldName}`;
    case "integer":
      return spec.minimum ?? 1;
    case "number":
      return spec.minimum ?? 1.0;
    case "boolean":
      return true;
    case "array":
      return [1];
    case "date":
      return "2024-01-15";
    case "datetime":
      return "2024-01-15T10:00:00Z";
    case "file":
      return "(file)";
    case "enum":
      return enumValues?.[0] ?? "option1";
    case "object":
      return {};
    default:
      return null;
  }
}

function specToEndpointArgs(
  spec: IValidationSpec,
): { key: string; value: string; description: string } {
  const v = exampleValueForField(spec);
  return {
    key: spec.fieldName,
    value: String(v),
    description: spec.description ?? spec.format ?? spec.type,
  };
}

export interface AdapterResult {
  readonly specs: EndpointSpec[];
  readonly routes: ReadonlyArray<ParsedRoute>;
  readonly withFormRequest: number;
  readonly withoutFormRequest: number;
}

/**
 * Construye `EndpointSpec[]` a partir de un `IRouteScanner` y, si
 * se da, su `IValidationSpecProvider`. Devuelve un `AdapterResult`
 * con la misma forma que el `discoverEndpoints` legacy.
 */
export async function buildSpecsFromScanner(
  scanner: IRouteScanner,
  match: IProjectMatch,
  validation: IValidationSpecProvider | null,
): Promise<AdapterResult> {
  const routes = await scanner.scan(match);
  const specs: EndpointSpec[] = [];
  let withFormRequest = 0;
  let withoutFormRequest = 0;

  for (const route of routes) {
    // Filtra métodos no estándar
    const m = route.method.toUpperCase();
    if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(m)) continue;

    const postmanUri = toPostmanUri(route.uri);
    const spec: EndpointSpec = {
      name: deriveName(route),
      method: m as EndpointSpec["method"],
      uri: postmanUri,
    };
    if (route.description) spec.description = route.description;
    if (route.tags && route.tags.length > 0) {
      spec.folder = route.tags[0];
    }

    // Los parámetros de path NO van en `spec.query`: eso se convierte en
    // query string, y `/users/{{id}}?id=1` no es lo que declara la ruta.
    // Se resuelven como variables de colección (`inferCollectionVariables`),
    // que es lo que hace que `{{id}}` tenga valor en Postman.

    // Validation rules
    if (validation) {
      let rules;
      try {
        rules = await validation.resolve(route, match);
      } catch {
        rules = null;
      }
      if (rules && rules.fields.length > 0) {
        // Guarda el ID del provider para que el enricher pueda
        // recuperar más tarde.
        spec.formRequest = `${match.framework}:${rules.endpointKey}`;
        withFormRequest += 1;
        const bodyFields = rules.fields.filter((f) => f.location === "body");
        const queryFields = rules.fields.filter((f) => f.location === "query");
        const headerFields = rules.fields.filter((f) => f.location === "header");
        const pathFields = rules.fields.filter((f) => f.location === "path");
        if (bodyFields.length > 0 && (m === "POST" || m === "PUT" || m === "PATCH")) {
          const body: Record<string, unknown> = {};
          for (const f of bodyFields) {
            if (!f.required) continue;
            body[f.fieldName] = exampleValueForField(f);
          }

          // Si NINGÚN campo es obligatorio, el body salía vacío y el
          // endpoint quedaba sin ejemplo. Y es justo el caso de los
          // `update`: un `UpdateUserRequest` declara todo con
          // `sometimes` porque se puede mandar solo lo que cambia. Un
          // PUT sin body es un ejemplo que no sirve para nada, que es
          // exactamente lo que esta herramienta viene a evitar.
          //
          // Cuando no hay obligatorios se emiten los opcionales: son lo
          // que el endpoint acepta, y quien importe la colección los ve
          // y borra lo que no quiera mandar.
          if (Object.keys(body).length === 0) {
            for (const f of bodyFields) body[f.fieldName] = exampleValueForField(f);
          }

          if (Object.keys(body).length > 0) spec.body = body;
        }
        // query: required + params derivados
        const queryFromRules = queryFields.map(specToEndpointArgs);
        const pathFromRules = pathFields.map((f) => ({
          key: f.fieldName,
          value: String(exampleValueForField(f)),
          description: f.description ?? `Path param ${f.fieldName}`,
        }));
        const extraQuery = [...queryFromRules, ...pathFromRules];
        if (extraQuery.length > 0) {
          const existing = spec.query ?? [];
          const existingKeys = new Set(existing.map((q) => q.key));
          for (const q of extraQuery) {
            if (!existingKeys.has(q.key)) existing.push(q);
          }
          spec.query = existing;
        }
        // Headers personalizados (X-API-Key, Authorization no-tokens, etc.)
        if (headerFields.length > 0) {
          spec.headers = headerFields.map((f) => ({
            key: f.fieldName,
            value: String(exampleValueForField(f)),
            description: f.description ?? `Header ${f.fieldName}`,
          }));
        }
      } else {
        withoutFormRequest += 1;
      }
    } else {
      withoutFormRequest += 1;
    }
    specs.push(spec);
  }
  return { specs, routes, withFormRequest, withoutFormRequest };
}

/** Helper: lee el primer byte de un spec OpenAPI para validación (no usado). */
export async function _peekSpec(projectRoot: string): Promise<string | null> {
  for (const rel of [
    "openapi.json",
    "openapi.yaml",
    "openapi.yml",
    "swagger.json",
    "swagger.yaml",
    "swagger.yml",
  ]) {
    try {
      const text = await readFile(join(projectRoot, rel), "utf8");
      if (text.length > 0) return rel;
    } catch {
      /* keep trying */
    }
  }
  return null;
}
