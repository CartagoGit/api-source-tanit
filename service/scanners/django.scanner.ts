/**
 * `DjangoScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * para proyectos Django (Python) y Django REST Framework.
 *
 * Detección:
 *   - `manage.py` (heurístico fuerte).
 *   - `pyproject.toml` o `requirements.txt` con `django` o `djangorestframework`.
 *
 * Parsing:
 *   - `urls.py`: regex sobre `path(...)` y `re_path(...)` y `include(...)`.
 *   - `views.py`: Para DRF, regex sobre `class XView(generics.ListAPIView)` /
 *     `ModelViewSet` con `queryset` y `serializer_class`.
 *   - Para vistas funcionales, regex sobre el decorador `@api_view(['GET', 'POST'])`
 *     o `@require_http_methods([...])`.
 *
 * Validation:
 *   - `DjangoSerializerProvider` extrae fields de `serializers.Serializer` o
 *     `serializers.ModelSerializer` con `class Meta: model = X; fields = [...]`.
 *   - En DRF, los serializers se infieren desde `serializer_class` en la view.
 *
 * Limitaciones:
 *   - Vistas basadas en funciones sin `@api_view` no se detectan.
 *   - Includes anidados pueden no resolver el `urls.py` del sub-app.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contract/scanner.interface.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"];

/**
 * Lee `pyproject.toml` y `requirements.txt` y devuelve true si
 * alguno contiene `django` o `djangorestframework`.
 */
async function isDjangoProject(projectRoot: string): Promise<boolean> {
  for (const file of ["pyproject.toml", "requirements.txt", "Pipfile"]) {
    const p = join(projectRoot, file);
    if (!existsSync(p)) continue;
    let raw: string;
    try {
      raw = await readFile(p, "utf8");
    } catch {
      continue;
    }
    if (/django/i.test(raw) || /djangorestframework/i.test(raw)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class DjangoProjectScanner implements IProjectScanner {
  readonly framework = "django" as const;

  async detect(projectRoot: string): Promise<number> {
    const hasManage = existsSync(join(projectRoot, "manage.py"));
    const isDjango = await isDjangoProject(projectRoot);
    if (!isDjango && !hasManage) return 0;
    if (hasManage) return 1;
    if (isDjango) return 0.8;
    return 0.5;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = [];
    if (existsSync(join(projectRoot, "manage.py"))) artifacts.push("manage.py");
    if (existsSync(join(projectRoot, "urls.py"))) artifacts.push("urls.py");
    if (existsSync(join(projectRoot, "app"))) artifacts.push("app");
    if (existsSync(join(projectRoot, "apps"))) artifacts.push("apps");
    return { framework: "django", projectRoot, artifacts };
  }
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

/**
 * Regex para `path('users/', views.list_users, name='list_users')` y
 * `path('users/<int:id>/', views.show_user)`.
 *
 * El viewRef puede terminar en:
 * - `(`   → `SomeView.as_view()` o `include(...)`.
 * - `)`   → idem (regex acepta ambas).
 * - `,`   → `path('foo', cancel_order, name='x')` (FBV referenciada por nombre).
 *
 * Esto cubre las tres formas que usa DRF para referenciar una view desde
 * `urlpatterns`.
 */
const PATH_RE =
  /path\s*\(\s*r?['"]([^'"]*)['"]\s*,\s*([\w.]+?)\s*(?:\(|\)|,)/g;
const INCLUDE_RE = /include\s*\(\s*(?:\[([^\]]+)\]|r?['"]([^'"]+)['"])/g;

/**
 * Decorator `@api_view(['GET', 'POST'])` para FBV de DRF.
 */
const API_VIEW_RE = /@api_view\s*\(\s*\[([^\]]+)\]\s*\)/;

/**
 * Convierte los path params Django al formato canónico Postman
 * SOLO para uso en `displayName`:
 *   `<int:id>` / `<str:slug>` / `<uuid:token>` → `{{id}}` / `{{slug}}` / `{{token}}`
 *   `<id>` → `{{id}}`
 *
 * NO confundir con `toPostmanUri` (en el adapter): esa normaliza la URI
 * completa; aquí solo necesitamos el pathTemplate ya formateado para que
 * el nombre del endpoint no diga literalmente "PUT <int:id>/status/".
 */
function normalizeDjangoPathParam(template: string): string {
  return template
    .replace(/<[a-zA-Z_][\w]*:([a-zA-Z_][\w]*)>/g, "{{$1}}")
    .replace(/<([a-zA-Z_][\w]*)>/g, "{{$1}}");
}

export class DjangoRouteScanner implements IRouteScanner {
  readonly framework = "django" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "django";
  }

  async scan(match: IProjectMatch): Promise<ParsedRoute[]> {
    const out: ParsedRoute[] = [];
    const projectRoot = match.projectRoot;
    const processed = new Set<string>(); // rutas absolutas ya procesadas.
    // 1) urls.py raíz. Buscar tanto en root como en sub-app típico
    //    (`app/urls.py`, `config/urls.py`, `src/urls.py`, etc.).
    const candidatesRoot: string[] = [
      join(projectRoot, "urls.py"),
    ];
    // Convención Django: `app/urls.py` si existe `manage.py` + `app/`.
    if (existsSync(join(projectRoot, "manage.py"))) {
      candidatesRoot.push(join(projectRoot, "app", "urls.py"));
      candidatesRoot.push(join(projectRoot, "config", "urls.py"));
      candidatesRoot.push(join(projectRoot, "src", "urls.py"));
      candidatesRoot.push(join(projectRoot, "project", "urls.py"));
    }
    for (const rootUrls of candidatesRoot) {
      if (existsSync(rootUrls) && !processed.has(rootUrls)) {
        processed.add(rootUrls);
        const rel = rootUrls.startsWith(projectRoot)
          ? rootUrls.slice(projectRoot.length + 1).split("/").join("/")
          : rootUrls;
        out.push(...(await parseUrlsPy(rootUrls, rel, projectRoot, "", processed)));
      }
    }
    // 2) Buscar urls.py en sub-apps (`<project>/<app>/urls.py`).
    //    Solo procesar si NO fue ya incluido desde el root.
    const subUrls = await findSubUrlsPy(projectRoot);
    for (const abs of subUrls) {
      if (processed.has(abs)) continue;
      processed.add(abs);
      const rel = abs.startsWith(projectRoot)
        ? abs.slice(projectRoot.length + 1).split("/").join("/")
        : abs;
      out.push(...(await parseUrlsPy(abs, rel, projectRoot, "", processed)));
    }
    return out;
  }
}

async function findSubUrlsPy(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  const dirs = ["app", "apps", "src"];
  for (const d of dirs) {
    const base = join(projectRoot, d);
    if (!existsSync(base)) continue;
    await walkUrlsPy(base, out);
  }
  return out;
}

async function walkUrlsPy(dir: string, out: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry === "urls.py") out.push(full);
    else if (!entry.includes(".") && !entry.endsWith(".py")) {
      await walkUrlsPy(full, out);
    }
  }
}

async function parseUrlsPy(
  absPath: string,
  relPath: string,
  projectRoot: string,
  parentPrefix: string,
  processed: Set<string>,
): Promise<ParsedRoute[]> {
  const out: ParsedRoute[] = [];
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    return [];
  }
  const text = stripPyComments(raw);
  for (const line of text.split("\n")) {
    // Detectar `path("prefix/", include(...))` en la misma línea:
    // extraer el prefix y procesarlo como include.
    PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PATH_RE.exec(line)) !== null) {
      const pathTemplate = m[1] ?? "";
      const viewRef = m[2] ?? "";
      // Si el viewRef es un `include(...)` (no una view), no es una ruta
      // terminal: tratarla como include anidado con este path como prefix.
      if (viewRef.startsWith("include") || viewRef.startsWith("views.")) {
        // `views.foo` es una FBV, no un include — seguir al bloque normal.
        if (viewRef.startsWith("include")) {
          const includeMatch = INCLUDE_RE.exec(line);
          INCLUDE_RE.lastIndex = 0;
          if (includeMatch) {
            await processInclude(
              includeMatch,
              absPath,
              projectRoot,
              parentPrefix + pathTemplate,
              processed,
              out,
            );
          }
          continue;
        }
      }
      // Limpiar `.as_view` para detectar la class base.
      const viewName = viewRef.replace(/\.as_view$/, "");
      const fullPath = (parentPrefix + pathTemplate).replace(/\/+/g, "/");
      // Para views de DRF (ViewSet), expandimos a `{list, retrieve, create, ...}`.
      // Resolvemos contra `views.py` para extraer la clase padre real o
      // el decorator `@api_view`, en lugar de heurística sobre el nombre.
      const expanded = await resolveViewMethods(viewName, projectRoot);
      // Normalizamos el pathTemplate (Django raw → Postman canonical) ANTES
      // de usarlo como displayName — así el nombre del endpoint no contiene
      // `<int:id>` literal sino `{{id}}` ya formateado. Si NO se hace aquí,
      // `deriveName` consumiría el `displayName` raw y el nombre quedaría
      // con sintaxis Django.
      const normalizedPathTemplate = normalizeDjangoPathParam(pathTemplate);
      for (const method of expanded) {
        out.push({
          method: method.toUpperCase(),
          uri: fullPath,
          rawUri: fullPath,
          sourceFile: relPath,
          lineNumber: 0,
          prefixChain: parentPrefix ? [parentPrefix] : [],
          displayName: `${method.toUpperCase()} ${normalizedPathTemplate}`,
          actionName: viewName,
        });
      }
    }
    // Includes top-level (sin path-prefix).
    INCLUDE_RE.lastIndex = 0;
    while ((m = INCLUDE_RE.exec(line)) !== null) {
      // Solo procesar si no fue ya consumido por PATH_RE.
      if (line.includes("path(") && line.indexOf("include(") > line.indexOf("path(")) {
        continue;
      }
      await processInclude(m, absPath, projectRoot, parentPrefix, processed, out);
    }
  }
  return out;
}

/**
 * Procesa un include: resuelve el archivo sub-urls y lo parsea recursivamente
 * con el prefix acumulado.
 */
async function processInclude(
  m: RegExpExecArray,
  absPath: string,
  projectRoot: string,
  parentPrefix: string,
  processed: Set<string>,
  out: ParsedRoute[],
): Promise<void> {
  const includeList = m[1] ?? "";
  const includePath = m[2] ?? "";
  if (includeList) {
    const innerPaths = [...includeList.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1] ?? "");
    for (const p of innerPaths) {
      const sub = join(absPath, "..", p);
      if (processed.has(sub)) continue;
      processed.add(sub);
      out.push(...(await parseUrlsPy(sub, p, projectRoot, parentPrefix, processed)));
    }
  } else if (includePath) {
    const parts = includePath.split(".");
    // Convención: el último segmento es el nombre del archivo (típicamente
    // `urls`); los anteriores son la jerarquía de directorios.
    const candidates = [
      // e.g. `app.auth.urls` → `app/auth/urls.py`
      join(projectRoot, parts.join("/")) + ".py",
      // e.g. `app.users.urls` → `apps/users/urls.py` (convención DRF)
      join(projectRoot, "apps", ...parts.slice(1)) + ".py",
      // e.g. `users.urls` → `<project>/users/urls.py`
      join(projectRoot, parts.join("/")) + ".py",
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        if (!processed.has(candidate)) {
          processed.add(candidate);
          const rel = candidate.startsWith(projectRoot)
            ? candidate.slice(projectRoot.length + 1).split("/").join("/")
            : candidate;
          out.push(...(await parseUrlsPy(candidate, rel, projectRoot, parentPrefix, processed)));
        }
        break;
      }
    }
  }
}

/**
 * Para ViewSets de DRF, retorna todos los métodos HTTP estándar según
 * el tipo de clase base.
 *
 * - `ModelViewSet` → GET (list, retrieve), POST (create), PUT/PATCH (update), DELETE.
 * - `ListCreateAPIView` → GET (list), POST (create).
 * - `RetrieveUpdateDestroyAPIView` → GET (retrieve), PUT/PATCH (update), DELETE.
 * - `RetrieveAPIView` → GET.
 * - `UpdateAPIView` → PUT/PATCH.
 * - `CreateAPIView` → POST.
 * - `DestroyAPIView` → DELETE.
 *
 * Para Function Based Views, retorna ["get"] como heurístico (se
 * sobreescribe con `@api_view([...])` si se detecta).
 */
function expandViewSetMethods(viewRef: string): string[] {
  if (
    viewRef.includes("ModelViewSet") ||
    viewRef.includes("ReadOnlyModelViewSet") ||
    viewRef.includes("ViewSet")
  ) {
    return ["get", "post", "put", "patch", "delete"];
  }
  if (viewRef.includes("ListCreateAPIView")) {
    return ["get", "post"];
  }
  if (viewRef.includes("RetrieveUpdateDestroyAPIView")) {
    return ["get", "put", "patch", "delete"];
  }
  if (viewRef.includes("UpdateAPIView")) {
    return ["put", "patch"];
  }
  if (viewRef.includes("CreateAPIView")) {
    return ["post"];
  }
  if (viewRef.includes("DestroyAPIView")) {
    return ["delete"];
  }
  if (viewRef.includes("RetrieveAPIView") || viewRef.includes("ListAPIView")) {
    return ["get"];
  }
  // FBV / API_view: heurístico "get".
  return ["get"];
}

/**
 * Cache de `views.py` leídos por módulo. Se rellena perezosamente y se
 * reutiliza entre invocaciones de `resolveViewMethods` para evitar
 * releer el mismo archivo N veces por cada endpoint.
 */
const VIEWS_PY_CACHE = new Map<string, string>();

async function readViewsPy(absPath: string): Promise<string | null> {
  if (VIEWS_PY_CACHE.has(absPath)) return VIEWS_PY_CACHE.get(absPath) ?? null;
  try {
    const raw = await readFile(absPath, "utf8");
    const text = stripPyComments(raw);
    VIEWS_PY_CACHE.set(absPath, text);
    return text;
  } catch {
    return null;
  }
}

/**
 * Encuentra todos los `views.py` del proyecto. Usado como fallback
 * cuando el `viewName` no es resoluble desde el archivo actual.
 *
 * Convención: `app/<x>/views.py` para Django clásico, `apps/<x>/views.py`
 * para proyectos con `apps/`, `<x>/views.py` para flat layouts.
 */
async function findAllViewsPy(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  const dirs = ["app", "apps", "src"];
  for (const d of dirs) {
    const base = join(projectRoot, d);
    if (!existsSync(base)) continue;
    await walkViewsPy(base, out);
  }
  // También buscar un views.py en la raíz (Django flat layout).
  const rootViews = join(projectRoot, "views.py");
  if (existsSync(rootViews)) out.push(rootViews);
  return out;
}

async function walkViewsPy(dir: string, out: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry === "views.py") out.push(full);
    else if (!entry.includes(".") && !entry.endsWith(".py")) {
      await walkViewsPy(full, out);
    }
  }
}

/**
 * Resuelve los métodos HTTP que una view expone. Estrategia:
 *
 * 1. Si el viewRef empieza con `views.` (formato `views.foo`), se
 *    interpreta como FBV local — buscar `def foo` y leer su `@api_view`.
 * 2. Si no, buscar en todos los `views.py` del proyecto:
 *    - `class X(generics.Y):` o `class X(Y):` → expandir Y via
 *      `expandViewSetMethods` (parent class name).
 *    - `@api_view([...])` antes de `def X(...)` → usar esos métodos.
 * 3. Fallback: `["get"]` (FBV sin decorator).
 */
async function resolveViewMethods(
  viewRef: string,
  projectRoot: string,
): Promise<string[]> {
  const name = viewRef.replace(/^views\./, "").replace(/\.as_view$/, "");
  // Si el viewRef era `include(...)` o vacío (no debería llegar aquí
  // por el flujo superior, pero por defensa), devolver [].
  if (!name || name === "include") return [];

  const candidates = await findAllViewsPy(projectRoot);
  for (const abs of candidates) {
    const text = await readViewsPy(abs);
    if (!text) continue;
    // 1) CBV: `class X(generics.Y):` o `class X(Y):`.
    const clsRe = new RegExp(
      `class\\s+${name}\\s*\\(\\s*(?:[\\w.]*\\.)?(\\w+)\\s*\\)\\s*:`,
    );
    const clsMatch = clsRe.exec(text);
    if (clsMatch) {
      return expandViewSetMethods(clsMatch[1] ?? "");
    }
    // 2) FBV: `@api_view([...])` antes de `def X(...)`.
    const fbvRe = new RegExp(
      `@api_view\\s*\\(\\s*\\[([^\\]]+)\\]\\s*\\)\\s*(?:[\\s\\S]*?)\\s*def\\s+${name}\\s*\\(`,
    );
    const fbvMatch = fbvRe.exec(text);
    if (fbvMatch) {
      const methods = (fbvMatch[1] ?? "")
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, "").toLowerCase())
        .filter((s) => HTTP_METHODS.includes(s));
      if (methods.length > 0) return methods;
    }
  }
  // Fallback: FBV sin decorator → heurístico GET.
  return ["get"];
}

function stripPyComments(src: string): string {
  return src
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/'''[\s\S]*?'''/g, " ")
    .replace(/^\s*#.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Validation spec provider — DRF Serializers
// ---------------------------------------------------------------------------

const FIELD_TYPE_MAP: Record<string, IValidationSpec["type"]> = {
  CharField: "string",
  EmailField: "string",
  URLField: "string",
  UUIDField: "string",
  IntegerField: "integer",
  FloatField: "number",
  DecimalField: "number",
  BooleanField: "boolean",
  DateField: "date",
  DateTimeField: "datetime",
  TimeField: "string",
  ChoiceField: "enum",
  ListField: "array",
  DictField: "object",
  JSONField: "object",
  SlugField: "string",
  IPAddressField: "string",
  FileField: "string",
  ImageField: "string",
  SerializerMethodField: "any",
  ReadOnlyField: "any",
  PrimaryKeyRelatedField: "integer",
  ManyRelatedField: "array",
  StringRelatedField: "string",
  HyperlinkedRelatedField: "string",
};

export class DjangoSerializerProvider implements IValidationSpecProvider {
  readonly framework = "django" as const;

  async supports(_r: ParsedRoute, _m: IProjectMatch): Promise<boolean> {
    return _m.framework === "django";
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile) return { endpointKey, fields: [] };
    const abs = join(match.projectRoot, route.sourceFile);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }
    const text = stripPyComments(raw);
    // Cuando `route.sourceFile` apunta a `urls.py`, la `serializer_class`
    // vive en el `views.py` hermano (mismo directorio). Resolver ahí primero
    // si el archivo actual es `urls.py`.
    const isUrlsPy = abs.endsWith("/urls.py");
    let searchText = text;
    if (isUrlsPy) {
      const dir = abs.substring(0, abs.lastIndexOf("/"));
      const viewsAbs = join(dir, "views.py");
      try {
        searchText = stripPyComments(await readFile(viewsAbs, "utf8"));
      } catch {
        // views.py no existe → searchText se queda como urls.py (no-op).
      }
    }
    // Si tenemos `actionName` (la view class o FBV específica de este
    // endpoint), localizamos el bloque de esa view para extraer SU
    // `serializer_class`. Si la view NO existe como `class X(...)` (FBV)
    // o no define `serializer_class`, devolvemos 0 fields — NUNCA el
    // "primer serializer del archivo", que sería el serializer de OTRA
    // view vecina y contaminaría el body de este endpoint.
    const viewName = route.actionName ?? "";
    let serializerName = "";
    if (viewName) {
      const clsRe = new RegExp(
        `class\\s+${viewName}\\b[\\s\\S]*?serializer_class\\s*=\\s*(\\w+Serializer)`,
      );
      const m = clsRe.exec(searchText);
      if (m) serializerName = m[1] ?? "";
    }
    // Si NO hay actionName (legacy fixtures sin actionName), caemos al
    // primer serializer del archivo (compatibilidad con fixtures previos).
    if (!viewName) {
      const serializerMatch =
        /serializer_class\s*=\s*(\w+Serializer)/.exec(searchText);
      if (serializerMatch) serializerName = serializerMatch[1] ?? "";
    }
    if (!serializerName) return { endpointKey, fields: [] };
    // Buscar la clase serializer dentro de archivos del mismo dir.
    // Si sourceFile es `urls.py`, los serializers están en el dir hermano.
    const dir = abs.substring(0, abs.lastIndexOf("/"));
    const serializerDef = await findSerializerDef(dir, serializerName);
    if (!serializerDef) return { endpointKey, fields: [] };
    return { endpointKey, fields: serializerDef };
  }
}

async function findSerializerDef(
  dir: string,
  className: string,
): Promise<IValidationSpec[] | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".py") || entry.endsWith(".bak")) continue;
    const abs = join(dir, entry);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    const text = stripPyComments(raw);
    const clsIdx = text.indexOf(`class ${className}`);
    if (clsIdx < 0) continue;
    // Cortar el bloque al inicio de la PRÓXIMA `class X(` o `class X:` para
    // no absorber los fields de clases vecinas (que es lo que produce
    // duplicados como `street` mezclado con `name`).
    // IMPORTANTE: el offset de `nextClsMatch` es relativo al texto DESPUÉS
    // de `clsIdx` (porque hacemos `text.slice(clsIdx)`), no a `text` absoluto.
    const fromCls = text.slice(clsIdx);
    const nextClsMatch = /\nclass\s+\w+\s*[:(]/.exec(fromCls);
    const block = nextClsMatch
      ? fromCls.slice(0, nextClsMatch.index)
      : fromCls;
    const fields: IValidationSpec[] = [];
    // 1) `fields = [...]` en Meta.
    const metaFields = /Meta\s*:[^]*?fields\s*=\s*\[([^\]]+)\]/.exec(block);
    let fieldNamesFromMeta: string[] = [];
    if (metaFields?.[1]) {
      fieldNamesFromMeta = metaFields[1]
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    // 2) Inline fields: `field_name = serializers.FieldType(...)`.
    const fieldRe = /^\s*([a-zA-Z_][\w]*)\s*=\s*serializers\.(\w+)\s*\(([^)]*)\)/gm;
    let m: RegExpExecArray | null;
    const inlineDefs = new Map<string, { type: string; args: string }>();
    while ((m = fieldRe.exec(block)) !== null) {
      inlineDefs.set(m[1] ?? "", { type: m[2] ?? "", args: m[3] ?? "" });
    }
    // 3) Emitir fields.
    if (fieldNamesFromMeta.length > 0) {
      for (const name of fieldNamesFromMeta) {
        const def = inlineDefs.get(name);
        const type = def ? FIELD_TYPE_MAP[def.type] ?? "any" : "any";
        const required = !(def?.args.includes("required=False") || def?.args.includes("read_only=True"));
        const field: IValidationSpec = {
          fieldName: name,
          location: "body",
          type,
          required,
        };
        if (def?.type === "EmailField") field.format = "email";
        if (def?.type === "URLField") field.format = "url";
        if (def?.type === "UUIDField") field.format = "uuid";
        if (def?.type === "ChoiceField") {
          const choices = /choices\s*=\s*\[([^\]]+)\]/.exec(def.args);
          if (choices?.[1]) {
            field.enumValues = choices[1]
              .split(",")
              .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
              .filter(Boolean);
          }
        }
        fields.push(field);
      }
    } else {
      // Sin Meta.fields: emitir los inline fields.
      for (const [name, def] of inlineDefs) {
        const type = FIELD_TYPE_MAP[def.type] ?? "any";
        const required = !(def.args.includes("required=false") || def.args.includes("read_only=true"));
        fields.push({
          fieldName: name,
          location: "body",
          type,
          required,
        });
      }
    }
    return fields;
  }
  return null;
}
