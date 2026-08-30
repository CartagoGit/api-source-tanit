/**
 * Descubre endpoints automáticamente a partir de las rutas Laravel
 * parseadas y, opcionalmente, de las firmas de los controladores
 * (FormRequest tipado en el método).
 *
 * No depende de un catálogo manual: basta con `routes/*.php` y
 * `app/Http/Controllers` + `app/Http/Requests`.
 *
 * El resultado es un `EndpointSpec[]` listo para `buildCollection()`.
 * Si se pasa un catálogo manual, se usa como **override** (misma
 * method+uri gana el manual: body, name, folder, description).
 */
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";
import { stripApiPrefix } from "../../core/helpers/uri.helper.js";
import { findFormRequestForController, generateCompleteBody, generateMinimalBody, parseFormRequest } from "./form-request-parser.service.js";
import { parseAllRoutes, stripComments } from "./route-parser.service.js";
import { mergeWithManual } from "../../core/domain/endpoint-merge.service.js";
import { prettyGroupName, topGroupFor } from "../../core/helpers/uri.helper.js";
import type { FormRequestRules, ParsedRoute } from "../../contracts/interfaces/frameworks/scanners.interface.js";

// ---------------------------------------------------------------------------
// Nombres legibles a partir del método del controlador
// ---------------------------------------------------------------------------

const METHOD_LABELS: Record<string, string> = {
  index: "Listar",
  show: "Ver",
  ver: "Ver",
  store: "Crear",
  crear: "Crear",
  create: "Crear",
  update: "Actualizar",
  editar: "Editar",
  destroy: "Eliminar",
  delete: "Eliminar",
  desactivar: "Desactivar",
  login: "Login",
  logout: "Cerrar sesión",
  alive: "Alive",
};

function humanizeMethod(methodName: string): string {
  if (METHOD_LABELS[methodName]) return METHOD_LABELS[methodName];
  // camelCase → "Camel Case"
  return methodName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function humanizeSegment(seg: string): string {
  if (!seg || seg.startsWith("{") || seg.startsWith("{{")) return "";
  return seg
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Convierte parámetros Laravel a variables Postman:
 *   `{usuario}`           → `{{usuario}}`
 *   `{fabricante:tecdoc_id}` → `{{fabricante}}`
 *   y deja la URI empezando por `/` sin prefijo `api/`.
 */
export function toPostmanUri(laravelUri: string): string {
  let u = stripApiPrefix(laravelUri.replace(/^\/+/, ""));
  u = u.replace(/\{([^}:]+)(?::[^}]+)?\}/g, "{{$1}}");
  if (!u.startsWith("/")) u = "/" + u;
  // Normaliza dobles barras y trailing slash (salvo raíz).
  u = u.replace(/\/+/g, "/");
  if (u.length > 1 && u.endsWith("/")) u = u.slice(0, -1);
  return u;
}

function endpointName(route: ParsedRoute, postmanUri: string): string {
  const action = route.actionName
    ? humanizeMethod(route.actionName)
    : route.method;
  const segs = postmanUri.split("/").filter((s) => s && !s.startsWith("{{"));
  const resource = segs.length ? humanizeSegment(segs[segs.length - 1] ?? "") : "";
  const prefix = segs.length > 1 ? humanizeSegment(segs[0] ?? "") : "";
  if (resource && prefix && resource.toLowerCase() !== prefix.toLowerCase()) {
    return `${action} ${resource}`.trim();
  }
  if (resource) return `${action} ${resource}`.trim();
  return action || `${route.method} ${postmanUri}`;
}

// ---------------------------------------------------------------------------
// Resolución de FormRequest desde el controlador
// ---------------------------------------------------------------------------

/** Cache: ruta abs del controlador → mapa methodName → FormRequest FQCN. */
const controllerFormRequestCache = new Map<
  string,
  Promise<Map<string, string>>
>();

/**
 * Parsea un controlador PHP y devuelve, por cada método público, el
 * primer parámetro tipado que termine en `Request` (FormRequest).
 */
async function parseControllerFormRequests(
  controllerFqcn: string,
  context: IProjectContext,
): Promise<Map<string, string>> {
  const root = context.projectRoot;

  // App\Http\Controllers\Foo\BarController → app/Http/Controllers/Foo/BarController.php
  const rel = controllerFqcn.replace(/^App\\/, "app/").replace(/\\/g, "/") + ".php";
  const abs = join(root, rel);
  if (controllerFormRequestCache.has(abs)) {
    return controllerFormRequestCache.get(abs)!;
  }

  const p = (async () => {
    const out = new Map<string, string>();
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      return out;
    }
    const text = stripComments(raw);

    // Imports: use A\B\FooRequest;  use A\B\FooRequest as BarRequest;
    const imports = new Map<string, string>();
    const importRe =
      /use\s+([A-Za-z0-9_\\]+)\\([A-Za-z0-9_]+)\s*(?:as\s+([A-Za-z0-9_]+))?\s*;/g;
    let im: RegExpExecArray | null;
    while ((im = importRe.exec(text)) !== null) {
      const fqcn = `${im[1]}\\${im[2]}`;
      const alias = im[3] ?? im[2];
      if (alias && /Request$/.test(alias)) {
        imports.set(alias, fqcn);
      }
    }

    // Métodos: public function name ( Type $var , ... ) — multilínea OK.
    const methodRe =
      /(?:public|protected)\s+function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/gs;
    let mm: RegExpExecArray | null;
    while ((mm = methodRe.exec(text)) !== null) {
      const methodName = mm[1];
      const params = mm[2] ?? "";
      if (!methodName) continue;
      // Cualquier parámetro tipado *Request (no solo el primero de la firma
      // si hubiera uniones raras; tomamos el primero que matchee).
      const typeRe = /(?:\\?([A-Za-z0-9_\\]*Request))\s+\$/g;
      let typeMatch: RegExpExecArray | null;
      let picked: string | null = null;
      while ((typeMatch = typeRe.exec(params)) !== null) {
        if (typeMatch[1]) {
          picked = typeMatch[1];
          break;
        }
      }
      if (!picked) continue;
      const typeName = picked.includes("\\")
        ? picked.split("\\").pop()!
        : picked;
      // Ignora Illuminate\Http\Request genérico.
      if (typeName === "Request" && !imports.has("Request")) continue;
      const fqcn =
        imports.get(typeName) ??
        (picked.includes("\\") ? picked.replace(/^\\/, "") : null);
      if (fqcn && /Request$/.test(fqcn) && !fqcn.endsWith("\\Request")) {
        out.set(methodName, fqcn);
      } else if (fqcn && fqcn.includes("Http\\Requests")) {
        out.set(methodName, fqcn);
      } else if (fqcn && /Request$/.test(typeName) && typeName !== "Request") {
        out.set(methodName, fqcn);
      }
    }
    return out;
  })();

  controllerFormRequestCache.set(abs, p);
  return p;
}

async function resolveFormRequestPath(
  fqcn: string,
  context: IProjectContext,
): Promise<string | null> {
  // App\Http\Requests\Usuarios\NuevoUsuarioRequest
  // → app/Http/Requests/Usuarios/NuevoUsuarioRequest.php
  if (!fqcn.startsWith("App\\Http\\Requests\\")) return null;
  const rel = fqcn.replace(/^App\\/, "app/").replace(/\\/g, "/") + ".php";
  try {
    const abs = join(context.projectRoot, rel);
    await readFile(abs, "utf8");
    return rel;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Construcción de EndpointSpec
// ---------------------------------------------------------------------------

async function routeToSpec(
  route: ParsedRoute,
  config: ProjectConfig,
  rulesCache: Map<string, FormRequestRules | null>,
  context: IProjectContext,
): Promise<EndpointSpec> {
  const postmanUri = toPostmanUri(route.uri);
  const overrides = config.uriGroupOverrides ?? {};
  const group = topGroupFor(postmanUri, overrides);
  const folder = prettyGroupName(group);

  const spec: EndpointSpec = {
    name: endpointName(route, postmanUri),
    method: route.method as EndpointSpec["method"],
    uri: postmanUri,
    folder,
  };

  // FormRequest desde firma del controlador (+ fallback por convención)
  let rules: FormRequestRules | null = null;
  if (route.controllerClass && route.actionName) {
    const map = await parseControllerFormRequests(route.controllerClass, context);
    const frFqcn = map.get(route.actionName);
    let rel: string | null = null;
    if (frFqcn) {
      rel = await resolveFormRequestPath(frFqcn, context);
    }
    if (!rel) {
      // Convención de nombre: IndexXRequest / StoreXRequest / etc.
      rel = await findFormRequestForController(
        route.controllerClass,
        route.actionName,
        context,
      );
    }
    if (rel) {
      // Normaliza a ruta relativa al proyecto si vino absoluta.
      if (rel.startsWith("/")) {
        try {
          rel = rel.slice(context.projectRoot.length + 1);
        } catch {
          /* keep abs */
        }
      }
      spec.formRequest = rel;
      if (!rulesCache.has(rel)) {
        try {
          const r = await parseFormRequest(rel, context);
          rulesCache.set(rel, r.isEmpty ? null : r);
        } catch {
          rulesCache.set(rel, null);
        }
      }
      rules = rulesCache.get(rel) ?? null;
    }
  }

  if (rules) {
    const method = route.method.toUpperCase();
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      // Body base = mínimo (required). El enricher añade más variantes.
      const min = generateMinimalBody(rules);
      const full = generateCompleteBody(rules);
      if (Object.keys(min).length > 0) spec.body = min;
      else if (Object.keys(full).length > 0) spec.body = full;
    }
    if (rules.className) {
      spec.description = `Auto · ${rules.className}`;
    }
  }

  return spec;
}

/**
 * Descubre todos los endpoints del proyecto.
 *
 * @param config ProjectConfig (filePrefixes, uriGroupOverrides…).
 * @param manualOverrides Catálogo manual opcional (gana en conflictos).
 */
export async function discoverEndpoints(
  config: ProjectConfig,
  manualOverrides: EndpointSpec[] = [],
  context: IProjectContext,
): Promise<{
  specs: EndpointSpec[];
  routes: ParsedRoute[];
  withFormRequest: number;
  withoutFormRequest: number;
}> {
  const routes = await parseAllRoutes(config.filePrefixes, context);
  const rulesCache = new Map<string, FormRequestRules | null>();
  const auto: EndpointSpec[] = [];
  let withFr = 0;
  let withoutFr = 0;

  for (const route of routes) {
    // Saltar closures / rutas sin método HTTP estándar ya filtradas.
    if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(route.method)) {
      continue;
    }
    const spec = await routeToSpec(route, config, rulesCache, context);
    if (spec.description?.startsWith("Auto ·")) withFr += 1;
    else withoutFr += 1;
    auto.push(spec);
  }

  const specs = mergeWithManual(auto, manualOverrides);
  return { specs, routes, withFormRequest: withFr, withoutFormRequest: withoutFr };
}
