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
import { collectFiles } from "../../helpers/fs-walk.helper.js";
import { joinRoutePath } from "../../helpers/uri.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/scanner.interface.js";

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
 */
const PATH_RE = /path\s*\(\s*r?['"]([^'"]*)['"]\s*,\s*([\w.]+?)\s*(?=\(|,|\))/g;
const INCLUDE_RE = /include\s*\(\s*(?:\[([^\]]+)\]|r?['"]([^'"]+)['"])/g;

/**
 * Decorator `@api_view(['GET', 'POST'])` para FBV de DRF.
 */
const API_VIEW_RE = /@api_view\s*\(\s*\[([^\]]+)\]\s*\)/;

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
      const fullPath = joinRoutePath("/", parentPrefix, pathTemplate);
      // Para views de DRF (ViewSet), expandimos a `{list, retrieve, create, ...}`.
      // Detectamos la herencia de la class en el archivo views.py de su módulo.
      const expanded = await expandViewSetMethods(viewName, projectRoot);
      for (const method of expanded) {
        out.push({
          method: method.toUpperCase(),
          uri: fullPath,
          rawUri: fullPath,
          sourceFile: relPath,
          lineNumber: 0,
          prefixChain: parentPrefix ? [parentPrefix] : [],
          displayName: `${method.toUpperCase()} ${pathTemplate}`,
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
      join(projectRoot, parts[0] ?? "") + ".py",
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
 * Si el viewName es un nombre de class (e.g. `UserListCreateView`), busca
 * el archivo `views.py` que lo define y extrae la herencia.
 *
 * Para Function Based Views, retorna ["get"] como heurístico (se
 * sobreescribe con `@api_view([...])` si se detecta).
 */
async function expandViewSetMethods(
  viewName: string,
  projectRoot: string,
): Promise<string[]> {
  // Class simple (e.g. `UserListCreateView`): buscar herencia en views.py.
  if (/^[A-Z][\w]*$/.test(viewName)) {
    const baseClass = await findBaseClass(viewName, projectRoot);
    return methodsFromBaseClass(baseClass);
  }
  // Cualquier nombre con `.` (e.g. `views.foo`) o minúscula (e.g. `foo`):
  // tratar como FBV y buscar `@api_view([...])` cerca de `def foo`.
  const fnName = viewName.includes(".") ? viewName.split(".").pop() ?? "" : viewName;
  if (/^[a-z_][\w]*$/.test(fnName)) {
    return methodsFromFunctionView(fnName, projectRoot);
  }
  // Default: heurístico.
  return ["get"];
}

function methodsFromBaseClass(baseClass: string | null): string[] {
  if (!baseClass) return ["get"];
  if (
    baseClass.includes("ModelViewSet") ||
    baseClass.includes("ReadOnlyModelViewSet") ||
    baseClass.includes("ViewSet")
  ) {
    return ["get", "post", "put", "patch", "delete"];
  }
  if (baseClass.includes("ListCreateAPIView")) {
    return ["get", "post"];
  }
  if (baseClass.includes("RetrieveUpdateDestroyAPIView")) {
    return ["get", "put", "patch", "delete"];
  }
  if (baseClass.includes("UpdateAPIView")) {
    return ["put", "patch"];
  }
  if (baseClass.includes("CreateAPIView")) {
    return ["post"];
  }
  if (baseClass.includes("DestroyAPIView")) {
    return ["delete"];
  }
  if (baseClass.includes("RetrieveAPIView") || baseClass.includes("ListAPIView")) {
    return ["get"];
  }
  return ["get"];
}

/**
 * Busca un archivo `views.py` en `app/<x>/views.py` o `apps/<x>/views.py`
 * y devuelve el nombre de la clase base de `className`.
 */
async function findBaseClass(
  className: string,
  projectRoot: string,
): Promise<string | null> {
  const candidates = [
    join(projectRoot, "app"),
    join(projectRoot, "apps"),
  ];
  for (const base of candidates) {
    if (!existsSync(base)) continue;
    let entries: string[];
    try {
      entries = await readdir(base);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const viewsPath = join(base, entry, "views.py");
      if (!existsSync(viewsPath)) continue;
      let raw: string;
      try {
        raw = await readFile(viewsPath, "utf8");
      } catch {
        continue;
      }
      const re = new RegExp(
        `class\\s+${className}\\s*\\(\\s*([\\w.]+)\\s*\\)`,
        "m",
      );
      const m = re.exec(raw);
      if (m) return m[1] ?? null;
    }
  }
  return null;
}

/**
 * Busca un archivo `views.py` con `def fnName` y devuelve los métodos
 * del `@api_view([...])` adyacente.
 */
async function methodsFromFunctionView(
  fnName: string,
  projectRoot: string,
): Promise<string[]> {
  const candidates = [
    join(projectRoot, "app"),
    join(projectRoot, "apps"),
    projectRoot,
  ];
  for (const base of candidates) {
    if (!existsSync(base)) continue;
    for (const abs of await collectFiles(base, (name) => name.endsWith("views.py"))) {
      let raw: string;
      try {
        raw = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      // Buscar `@api_view(['POST'])` seguido de `def fnName`.
      const re = new RegExp(
        `@api_view\\s*\\(\\s*\\[([^\\]]+)\\]\\s*\\)\\s*(?:\\n[\\s\\S]*?)?def\\s+${fnName}\\b`,
        "m",
      );
      const m = re.exec(raw);
      if (m) {
        const list = m[1] ?? "";
        const verbs = list
          .split(",")
          .map((s) =>
            s
              .trim()
              .replace(/^['"]|['"]$/g, "")
              .toLowerCase(),
          )
          .filter((s) => ["get", "post", "put", "patch", "delete"].includes(s));
        return verbs.length > 0 ? verbs : ["get"];
      }
    }
  }
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
    const dir = abs.substring(0, abs.lastIndexOf("/"));
    // 1) Encontrar el viewName para este URI leyendo el urls.py.
    //    Pasamos también el prefixChain para desambiguar.
    const viewName = await findViewNameForUri(
      abs,
      route.uri,
      route.prefixChain ?? [],
    );
    if (!viewName) return { endpointKey, fields: [] };
    // 2) Leer views.py y encontrar `class viewName(...)` para extraer
    //    el `serializer_class = XSerializer`.
    const viewsPath = join(dir, "views.py");
    let serializerName: string | null = null;
    try {
      const viewsRaw = await readFile(viewsPath, "utf8");
      const viewsText = stripPyComments(viewsRaw);
      // Encontrar el bloque de la class viewName. Estrategia: split en
      // bloques de class (cada uno termina antes del próximo `^class`).
      // Si es la última class, el bloque llega hasta el final del archivo.
      const classBlocks: Array<{ name: string; body: string }> = [];
      const classStartRe = /^class\s+(\w+)/gm;
      let m: RegExpExecArray | null;
      const starts: Array<{ name: string; index: number }> = [];
      while ((m = classStartRe.exec(viewsText)) !== null) {
        starts.push({ name: m[1] ?? "", index: m.index });
      }
      for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const next = starts[i + 1];
        const body = next
          ? viewsText.slice(start.index, next.index)
          : viewsText.slice(start.index);
        classBlocks.push({ name: start.name, body });
      }
      const clsBlock = classBlocks.find((b) => b.name === viewName);
      if (clsBlock) {
        const sm = /serializer_class\s*=\s*(\w+Serializer)/.exec(clsBlock.body);
        if (sm) serializerName = sm[1] ?? null;
      }
      // FBV fallback: si viewName es minúscula (FBV), buscar serializers
      // cuyo nombre contenga el funcName capitalized.
      if (!serializerName && /^[a-z][\w]*$/.test(viewName)) {
        const capitalized = viewName.charAt(0).toUpperCase() + viewName.slice(1);
        try {
          const serRaw = await readFile(join(dir, "serializers.py"), "utf8");
          // Buscar `class XYZSerializer` donde XYZ contiene `capitalized`.
          const match = new RegExp(
            `class\\s+(\\w*${capitalized}\\w*Serializer)\\b`,
            "m",
          );
          const m = match.exec(serRaw);
          if (m) serializerName = m[1] ?? null;
        } catch {
          // serializers.py no existe.
        }
      }
    } catch {
      // views.py no existe.
    }
    if (!serializerName) return { endpointKey, fields: [] };
    const serializerDef = await findSerializerDef(dir, serializerName);
    if (!serializerDef) return { endpointKey, fields: [] };
    return { endpointKey, fields: serializerDef };
  }
}

/**
 * Lee el archivo urls.py del dir y devuelve el nombre de la view
 * (class o función) que matchea el URI dado.
 */
async function findViewNameForUri(
  urlsAbs: string,
  uri: string,
  prefixChain: string[],
): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(urlsAbs, "utf8");
  } catch {
    return null;
  }
  const text = stripPyComments(raw);
  // URI viene con prefix ya incluido. Quitar el primer prefix para
  // comparar contra el pathTemplate del sub-urls.py.
  // Ambos lados se comparan sin barra inicial: la URI la trae desde que
  // los scanners emiten rutas absolutas, pero el prefixChain guarda el
  // prefijo tal cual lo declara `include(...)`, sin ella.
  const stripLeadingSlash = (value: string): string => value.replace(/^\/+/, "");
  let relative = stripLeadingSlash(uri);
  if (prefixChain.length > 0) {
    const firstPrefix = stripLeadingSlash(prefixChain[0] ?? "");
    if (firstPrefix && relative.startsWith(firstPrefix)) {
      relative = relative.slice(firstPrefix.length);
    }
  }
  // `{{id}}` → `<id>` (sin `:` tipo) para comparar con Django.
  relative = relative.replace(/\{\{(\w+)\}\}/g, "<$1>");
  // También normalizar `<int:id>` → `<id>` (en caso de que uri aún tenga
  // la forma Django porque viene directo del scanner).
  relative = relative.replace(/<\w+:(\w+)>/g, "<$1>");
  // Quitar trailing slash para comparar sin él.
  relative = relative.replace(/\/+$/, "");
  // Si relative es vacío (lista), buscar path("").
  if (relative === "") {
    for (const line of text.split("\n")) {
      if (/path\s*\(\s*r?['"]['"]/.test(line)) {
        const refMatch = /,\s*([\w.]+?)\s*(?=\(|,|\))/.exec(line);
        if (refMatch) {
          return (refMatch[1] ?? "").replace(/\.as_view$/, "");
        }
      }
    }
    return null;
  }
  for (const line of text.split("\n")) {
    PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PATH_RE.exec(line)) !== null) {
      const pathTemplate = (m[1] ?? "").replace(/^\/+|\/+$/g, "");
      const viewRef = (m[2] ?? "").replace(/\.as_view$/, "");
      // Normalizar el pathTemplate: `<int:id>` → `<id>` para matchear.
      const pathNormalized = pathTemplate.replace(/<\w+:(\w+)>/g, "<$1>");
      // Quitar trailing slash también en pathNormalized.
      const pathNoSlash = pathNormalized.replace(/\/+$/, "");
      if (pathNoSlash === relative || pathNormalized === relative) {
        return viewRef || null;
      }
    }
  }
  return null;
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
    // Recortar el bloque hasta la siguiente `class` (o fin de archivo).
    const afterCls = text.slice(clsIdx);
    const nextClass = afterCls.search(/\nclass\s+\w+/);
    const block =
      nextClass > 0 ? afterCls.slice(0, nextClass) : afterCls;
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
