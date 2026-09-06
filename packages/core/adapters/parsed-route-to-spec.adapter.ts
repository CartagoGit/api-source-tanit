/**
 * Universal adapter: `ParsedRoute` (neutral) → `EndpointSpec` (Postman).
 *
 * Accepts an `IRouteScanner` (any framework) and an optional
 * `IValidationSpecProvider`, and returns the same shape as
 * `endpoint-discovery.service.ts > discoverEndpoints()`:
 *
 *   {
 *     specs: EndpointSpec[],
 *     routes: ParsedRoute[],
 *     withFormRequest: number,
 *     withoutFormRequest: number,
 *   }
 *
 * What this adapter does NOT do (deliberately):
 *   - Does not assign `folder` automatically (collection-builder does that).
 *   - Does not infer heuristic body/query (that is `param-inferrer.service.ts`
 *     and is applied separately in the `generate` script).
 *   - Does not enrich with variants (that is `catalog-enricher.service.ts`).
 *
 * The `formRequest` of `EndpointSpec` is set to the FQCN (or path)
 * the `IValidationSpecProvider` resolved, as an identifier string. The
 * enricher will use it to load additional rules.
 *
 * **S5 (a00012)** — in addition to the inherited `formRequest: string`
 * field, the adapter now writes `validationSource` with the resolved
 * **provider**. For now there is only one provider we know how to
 * route (`"laravel-form-request"`); other frameworks leave the field
 * `undefined` and their `validation.resolve()` is ignored, which is
 * what closes the invariant "an Express project NEVER enters
 * `enrichCatalogWithFormRequests`".
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SUPPORTED_METHODS } from "../../contracts/constants/core/postman.constant.js";
import type { ValidationProvider } from "../../contracts/constants/core/validation-provider.constant.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import { deriveServiceId } from "../discovery/group-by-service.helper.js";
import type {
  IProjectMatch,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";
import type { AdapterResult } from "../../contracts/interfaces/core/discovery.interface.js";

/**
 * Translates route parameters to the Postman format: `{{x}}`.
 *
 * Just that. It lives apart from `toPostmanUri` because it also applies
 * to the **names** of the requests, and a name is not a path: it has
 * no leading slash and its slashes are not collapsed.
 */
function toPostmanParams(text: string): string {
  let u = text;
  // Step 1: `<int:id>`, `<str:slug>`, `<id>` (Django) → `{{id}}`.
  //          MUST come before `:param` to prevent `<int:id>` from
  //          breaking into `<int{{id}}>` (because `:id` would match `:param`).
  u = u.replace(/<[a-zA-Z_][\w]*:([a-zA-Z_][\w]*)>/g, "{{$1}}");
  u = u.replace(/<([a-zA-Z_][\w]*)>/g, "{{$1}}");
  // Step 2: `:param` (Express) → `{{param}}`.
  u = u.replace(/:([a-zA-Z_][\w]*)/g, "{{$1}}");
  // Step 3: `{param}` (Laravel) → `{{param}}`. Negative lookbehind to
  // NOT match if the `{` is preceded by another `{` (that is `{{param}}`).
  return u.replace(/(?<!\{)\{([a-zA-Z_][\w]*)\}(?!\})/g, "{{$1}}");
}

/** Converts `{x}` or `:x` (Express) to `{{x}}`. The URI already comes
 * with the prefix applied from the scanner; here we only normalize the
 * canonical Postman format (`{{param}}` and leading `/`). */
export function toPostmanUri(laravelUri: string): string {
  let u = toPostmanParams(laravelUri.trim());
  // Note: we do NOT strip `api/vN/` prefixes automatically. The real
  // backend prefix depends on the framework:
  //   - Laravel: RouteServiceProvider strips `api/` → collection goes without it.
  //   - ASP.NET, Spring Boot, Gin, NestJS: the prefix is real → kept.
  // The scanner must emit the URI exactly as it should appear in Postman.
  if (!u.startsWith("/")) u = "/" + u;
  u = u.replace(/\/+/g, "/");
  // The trailing slash is KEPT: in Django (`APPEND_SLASH = True`, the
  // default) `/users` redirects 301 to `/users/`, and a POST loses the
  // body in the redirect. It is the scanner's responsibility to emit
  // the URI exactly as it should be called.
  return u;
}

/**
 * Derives a readable name from the HTTP method + URI.
 *
 * It is exported so it can be tested on its own: it is a pure function
 * of the route, and the alternative would force assembling an entire
 * scanner to check what a name looks like.
 */
export function deriveName(route: ParsedRoute): string {
  // A name is NOT a path. This used to go through `toPostmanUri`, which
  // prepended a slash to anything that did not have one: the Next.js
  // scanner emitted `POST /orders` and Postman got `/POST /orders`, and
  // the FastAPI one emitted `create_user` and it came out as
  // `/create_user`. It affected all six scanners that set `displayName`.
  //
  // What still needs translating are parameters, because a name like
  // `GET /users/:id` must read the same as its URI.
  if (route.displayName) return toPostmanParams(route.displayName.trim());
  // Normalize the URI for the displayName (e.g. `<int:id>` → `{{id}}`,
  // `:id` → `{{id}}`).
  const uri = toPostmanUri(route.uri);
  // The name ends up in the Postman UI, so it goes in English: people
  // from any country use it.
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
  // Common headers: useful placeholders.
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
 * Resolves which framework-agnostic `ValidationProvider` corresponds
 * to a framework.
 *
 * S5 (a00012): for now only Laravel has a registered enricher
 * (`LARAVEL_FORM_REQUEST_ENRICHER`). The other frameworks leave the
 * endpoint's `validationSource` as `undefined`, and that is what
 * guarantees `enrichCatalogWithFormRequests` (which only understands
 * FormRequests) is not applied to them by accident.
 *
 * Pure function: lives here, not in runtime, so adding a new provider
 * is an isolated change next to the adapter that emits it.
 */
function laravelFormRequestProvider(
  framework: string,
): ValidationProvider | undefined {
  return framework === "laravel" ? "laravel-form-request" : undefined;
}

/**
 * Builds `EndpointSpec[]` from an `IRouteScanner` and, if given, its
 * `IValidationSpecProvider`. Returns an `AdapterResult` with the same
 * shape as the legacy `discoverEndpoints`.
 */
export async function buildSpecsFromScanner(
  scanner: IRouteScanner,
  match: IProjectMatch,
  validation: IValidationSpecProvider | null,
): Promise<AdapterResult> {
  // The `framework` is set here by whoever collects, not by each
  // scanner: the registry already knows which one it is, and asking
  // the twenty-one scanners to repeat their own id on every route
  // would be asking them to remember something that is already
  // written. It was not there before, and the OpenAPI one invented
  // `__params` with `as any` to recognize its own.
  //
  // `scanResult` is preserved entirely: in addition to the routes it
  // carries the auxiliary maps the scanner collected (schemas,
  // validators, structs), and it is passed to the provider so its
  // reading does not depend on mutable state in the scanner
  // (a00010 S2).
  const scanResult: IScanResult = await scanner.scan(match);
  const routes = scanResult.routes.map((route) => ({
    framework: scanner.framework,
    ...route,
  }));
  const specs: EndpointSpec[] = [];
  const validationFailures: string[] = [];
  let withFormRequest = 0;
  let withoutFormRequest = 0;

  for (const route of routes) {
    // Methods that Postman cannot represent are dropped. The list comes
    // from the contract itself, so adding one there does not require
    // remembering this line: it was what made HEADs disappear.
    const m = route.method.toUpperCase();
    if (!(SUPPORTED_METHODS as readonly string[]).includes(m)) continue;

    const postmanUri = toPostmanUri(route.uri);
    const spec: EndpointSpec = {
      // x00028 S3: stamp the workspace on each spec so cross-service
      // dedupe and per-service filtering can distinguish two specs
      // that share `(method, uri)` but live in different workspaces.
      serviceId: deriveServiceId(match),
      name: deriveName(route),
      method: m as EndpointSpec["method"],
      uri: postmanUri,
    };
    if (route.description) spec.description = route.description;
    // A body the scanner already knows wins over any inference: the
    // GraphQL query is a document, not loose fields, and decomposing
    // it just to reassemble it can only break it.
    if (route.body !== undefined) spec.body = route.body;
    if (route.tags && route.tags.length > 0) {
      spec.folder = route.tags[0];
    }
    // Audit 2nd review #17: the per-operation auth override propagates
    // to the `EndpointSpec` so the merger can respect it. Previously
    // the adapter ignored `route.auth` (which did not exist in the
    // contract), so all per-route auth had to come from the global
    // heuristic. Now scanners that need to mark an endpoint as public
    // / apiKey / oauth2 declare it on the route and the adapter
    // carries it to the spec without transformations.
    if (route.auth !== undefined) spec.auth = route.auth;
    // Audit 2026-09-06 §17, proposal r00015: the scanner may stamp a
    // confidence annotation on the route (Pages Router multi-verb,
    // fixtures without types, future heuristics). Copy it across so
    // exporters can render it. Scanners that leave it `undefined`
    // get `high` by default — see Postman / OpenAPI exporters.
    if (route.confidence !== undefined) spec.confidence = route.confidence;
    // Audit 2026-09-06 §11, proposal f00013: scanners for non-HTTP
    // transports (gRPC today, WebSocket/SSE/AsyncAPI later) emit
    // `transport` + `transportMeta` on the route. The adapter copies
    // them through so the spec is recognised downstream. HTTP routes
    // leave both `undefined` and the Postman/OpenAPI exporters
    // default to `"http"` behaviour.
    if (route.transport !== undefined) {
      spec.transport = route.transport;
      if (route.transportMeta !== undefined) {
        spec.transportMeta = route.transportMeta;
      }
    }

    // Path parameters do NOT go in `spec.query`: that becomes a query
    // string, and `/users/{{id}}?id=1` is not what the route declares.
    // They are resolved as collection variables
    // (`inferCollectionVariables`), which is what makes `{{id}}` have
    // a value in Postman.

    // Validation rules
    if (validation) {
      let rules;
      try {
        rules = await validation.resolve(route, match, scanResult);
      } catch (error) {
        // Recorded instead of swallowed. A provider that threw left
        // the endpoint indistinguishable from one without validation,
        // so a broken parser — a syntax change in the framework, a
        // file that is no longer read — silently degraded the
        // collection.
        //
        // Not propagated: an endpoint without rules is still a valid
        // collection, and aborting the entire generation for a broken
        // parser would be worse. But it must be reported.
        validationFailures.push(
          `${route.method.toUpperCase()} ${route.uri}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        rules = null;
      }
      if (rules && rules.fields.length > 0) {
        // Identifier of the provider the enricher will use to load
        // additional rules. `formRequest` (legacy string) is kept for
        // compat with `enrichCatalogWithFormRequests` and with tests
        // that still read it; the new contract lives in
        // `validationSource` and is framework-agnostic.
        const formRequestRef = `${match.framework}:${rules.endpointKey}`;
        spec.formRequest = formRequestRef;
        // S5: we only write `validationSource` for providers that have
        // a registered enricher. Today that is exclusively
        // `"laravel-form-request"`; the rest leaves the field
        // `undefined` and saves an unnecessary pass through the wrong
        // enricher.
        const provider = laravelFormRequestProvider(match.framework);
        if (provider) {
          spec.validationSource = { provider, reference: formRequestRef };
        }
        // The rules travel with the spec, not only their result.
        // From the example body already built there is no way to
        // recover what was required or what format each field had,
        // and that is exactly what must be documented in the request.
        withFormRequest += 1;
        const bodyFields = rules.fields.filter((f) => f.location === "body");
        const queryFields = rules.fields.filter((f) => f.location === "query");
        const headerFields = rules.fields.filter((f) => f.location === "header");
        // A `GET`, `DELETE`, `HEAD` or `OPTIONS` has no body, so its
        // body rules cannot be its own: they belong to a neighbor.
        //
        // Providers that look for "the nearest schema" when the
        // handler does not reference one attach it to anyone — the
        // `GET /users` in the Express example ended up with the
        // fields of `POST /orders`. While those rules only fed the
        // example body it did not show, because the body was already
        // skipped for these methods; once they started being
        // documented (p00031) and showing up in the OpenAPI (p00032),
        // the document described a GET with a body, which does not
        // exist.
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

          // If NO field is required, the body came out empty and the
          // endpoint was left without an example. And that is exactly
          // the case for `update` requests: an `UpdateUserRequest`
          // declares everything as `sometimes` because you can send
          // only what changes. A PUT with no body is an example that
          // serves no purpose, which is exactly what this tool comes
          // to avoid.
          //
          // When there are no required fields, we emit the optional
          // ones: they are what the endpoint accepts, and whoever
          // imports the collection sees them and deletes what they do
          // not want to send.
          if (Object.keys(body).length === 0) {
            for (const f of bodyFields) body[f.fieldName] = exampleValueForField(f);
          }

          if (Object.keys(body).length > 0) spec.body = body;
        }
        // query: only rules with `location === "query"`.
        //
        // Rules with `location === "path"` are NOT concatenated into
        // `spec.query`: path params are a conceptually different
        // thing, and mixing them produced `GET /users/{{id}}?id=1` —
        // the same parameter declared twice. The a00010 audit (B-01)
        // caught it on HEAD; rules with `location: "path"` keep
        // traveling in `spec.fields` and the OpenAPI exporter renders
        // them as `parameters` with `in: path` from
        // `pathParamsOf(spec.uri)`, so fidelity is not lost.
        const queryFromRules = queryFields.map(specToEndpointArgs);
        if (queryFromRules.length > 0) {
          const existing = spec.query ?? [];
          const existingKeys = new Set(existing.map((q) => q.key));
          for (const q of queryFromRules) {
            if (!existingKeys.has(q.key)) existing.push(q);
          }
          spec.query = existing;
        }
        // Custom headers (X-API-Key, non-token Authorization, etc.)
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
  return { specs, routes, withFormRequest, withoutFormRequest, validationFailures };
}

/** Helper: reads the first byte of an OpenAPI spec for validation (unused). */
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
