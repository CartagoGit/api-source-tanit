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
import { SUPPORTED_METHODS } from "../../contracts/constants/core/postman.constant.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type {
  IProjectMatch,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";
import type { AdapterResult } from "../../contracts/interfaces/core/discovery.interface.js";

/**
 * Traduce los parámetros de ruta al formato de Postman: `{{x}}`.
 *
 * Solo eso. Va aparte de `toPostmanUri` porque también se aplica a los
 * **nombres** de las requests, y un nombre no es una ruta: no lleva
 * barra inicial ni se le colapsan las barras.
 */
function toPostmanParams(text: string): string {
  let u = text;
  // Paso 1: `<int:id>`, `<str:slug>`, `<id>` (Django) → `{{id}}`.
  //         DEBE ir antes que `:param` para evitar que `<int:id>` se
  //         rompa en `<int{{id}}>` (porque `:id` matchearía `:param`).
  u = u.replace(/<[a-zA-Z_][\w]*:([a-zA-Z_][\w]*)>/g, "{{$1}}");
  u = u.replace(/<([a-zA-Z_][\w]*)>/g, "{{$1}}");
  // Paso 2: `:param` (Express) → `{{param}}`.
  u = u.replace(/:([a-zA-Z_][\w]*)/g, "{{$1}}");
  // Paso 3: `{param}` (Laravel) → `{{param}}`. Lookbehind negativo para
  // NO matchear si el `{` va precedido de otro `{` (eso es `{{param}}`).
  return u.replace(/(?<!\{)\{([a-zA-Z_][\w]*)\}(?!\})/g, "{{$1}}");
}

/** Convierte `{x}` o `:x` (Express) a `{{x}}`. La URI ya viene con
 * prefix aplicado desde el scanner; aquí solo normalizamos el formato
 * canónico Postman (`{{param}}` y `/` inicial). */
export function toPostmanUri(laravelUri: string): string {
  let u = toPostmanParams(laravelUri.trim());
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

/**
 * Deriva un nombre legible a partir del método HTTP + URI.
 *
 * Se exporta para poder probarla sola: es una función pura de la ruta, y
 * lo contrario obligaría a montar un scanner entero para comprobar cómo
 * queda un nombre.
 */
export function deriveName(route: ParsedRoute): string {
  // Un nombre NO es una ruta. Esto pasaba por `toPostmanUri`, que le
  // pegaba una barra delante a todo lo que no la llevara: el scanner de
  // Next.js emitía `POST /orders` y en Postman salía `/POST /orders`, y
  // el de FastAPI emitía `create_user` y salía `/create_user`. Afectaba
  // a los seis scanners que ponen `displayName`.
  //
  // Lo que sí hay que traducir son los parámetros, porque un nombre como
  // `GET /users/:id` tiene que leerse igual que su URI.
  if (route.displayName) return toPostmanParams(route.displayName.trim());
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
  // El `framework` lo pone aquí quien recoge, no cada scanner: el
  // registro ya sabe cuál es, y pedirle a los veintiún scanners que
  // repitan su propio id en cada ruta sería pedirles que se acuerden de
  // algo que ya está escrito. Antes no estaba, y el de OpenAPI se
  // inventó `__params` con `as any` para reconocer las suyas.
  const routes = (await scanner.scan(match)).map((route) => ({
    framework: scanner.framework,
    ...route,
  }));
  const specs: EndpointSpec[] = [];
  let withFormRequest = 0;
  let withoutFormRequest = 0;

  for (const route of routes) {
    // Se descartan los métodos que Postman no sabe representar. La
    // lista sale del propio contrato para que añadir uno allí no exija
    // acordarse de esta línea: era lo que hacía desaparecer los HEAD.
    const m = route.method.toUpperCase();
    if (!(SUPPORTED_METHODS as readonly string[]).includes(m)) continue;

    const postmanUri = toPostmanUri(route.uri);
    const spec: EndpointSpec = {
      name: deriveName(route),
      method: m as EndpointSpec["method"],
      uri: postmanUri,
    };
    if (route.description) spec.description = route.description;
    // Un cuerpo que el scanner ya conoce gana sobre cualquier inferencia:
    // la consulta de GraphQL es un documento, no unos campos sueltos, y
    // descomponerla para volver a montarla solo puede estropearla.
    if (route.body !== undefined) spec.body = route.body;
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
        // Las reglas viajan con el spec, no solo su resultado. Del `body`
        // de ejemplo ya construido no hay forma de recuperar qué era
        // obligatorio ni qué formato tenía cada campo, y eso es
        // exactamente lo que hay que documentar en la request.
        withFormRequest += 1;
        const bodyFields = rules.fields.filter((f) => f.location === "body");
        const queryFields = rules.fields.filter((f) => f.location === "query");
        const headerFields = rules.fields.filter((f) => f.location === "header");
        const pathFields = rules.fields.filter((f) => f.location === "path");
        // Un `GET`, `DELETE`, `HEAD` u `OPTIONS` no lleva cuerpo, así que
        // sus reglas de body no pueden ser suyas: son las del vecino.
        //
        // Los providers que buscan "el esquema más cercano" cuando el
        // handler no referencia ninguno se lo cuelgan a cualquiera — el
        // `GET /users` del ejemplo de Express acababa con los campos del
        // `POST /orders`. Mientras esas reglas solo alimentaban el body
        // de ejemplo no se veía, porque el body ya se saltaba estos
        // métodos; en cuanto empezaron a documentarse (p00031) y a salir
        // en el OpenAPI (p00032), el documento describía un GET con
        // cuerpo, que no existe.
        const takesBody = m === "POST" || m === "PUT" || m === "PATCH";
        const applicable = takesBody
          ? rules.fields
          : rules.fields.filter((f) => f.location !== "body");
        if (applicable.length > 0) spec.fields = applicable;

        if (bodyFields.length > 0 && takesBody) {
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
