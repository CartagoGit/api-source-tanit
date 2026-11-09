/**
 * `DjangoScanner` — implementation of `IProjectScanner` + `IRouteScanner`
 * for Django (Python) projects and Django REST Framework.
 *
 * Detection:
 *   - `manage.py` (strong heuristic).
 *   - `pyproject.toml` or `requirements.txt` with `django` or
 *     `djangorestframework`.
 *
 * Parsing:
 *   - `urls.py`: regex over `path(...)`, `re_path(...)` and `include(...)`.
 *   - `views.py`: for DRF, regex over
 *     `class XView(generics.ListAPIView)` / `ModelViewSet` with
 *     `queryset` and `serializer_class`.
 *   - For function views, regex over the decorator
 *     `@api_view(['GET', 'POST'])` or `@require_http_methods([...])`.
 *
 * Validation:
 *   - `DjangoSerializerProvider` extracts fields from
 *     `serializers.Serializer` or `serializers.ModelSerializer` with
 *     `class Meta: model = X; fields = [...]`.
 *   - In DRF, serializers are inferred from `serializer_class` in the view.
 *
 * Limitations:
 *   - Function-based views without `@api_view` are not detected.
 *   - Nested includes may not resolve the sub-app's `urls.py`.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { collectFiles } from "../../core/helpers/fs-walk.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";


/**
 * Reads `pyproject.toml` and `requirements.txt` and returns true if
 * either contains `django` or `djangorestframework`.
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

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const hasManage = existsSync(join(projectRoot, "manage.py"));
    const isDjango = await isDjangoProject(projectRoot);
    if (!isDjango && !hasManage) return emptyResult(0);
    if (hasManage) {
      return withEvidence(1, [
        { signal: "manage.py presente (entry-point canónico de Django)", weight: 0.5, artifact: "manage.py" },
        ...(isDjango ? [{ signal: "Django referenciado en requirements/requirements.txt/pyproject.toml", weight: 0.5, artifact: isDjango.toString().includes("requirements") ? "requirements.txt" : "pyproject.toml" }] : []),
      ]);
    }
    if (isDjango) return withEvidence(0.8, [{ signal: "Django declarado como dependencia del proyecto", weight: 0.8, artifact: "requirements.txt" }]);
    return emptyResult(0);
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
 * Regex for `path('users/', views.list_users, name='list_users')` and
 * `path('users/<int:id>/', views.show_user)`.
 */
const PATH_RE = /path\s*\(\s*r?['"]([^'"]*)['"]\s*,\s*([\w.]+?)\s*(?=\(|,|\))/g;
const INCLUDE_RE = /include\s*\(\s*(?:\[([^\]]+)\]|r?['"]([^'"]+)['"])/g;

/**
 * Decorator `@api_view(['GET', 'POST'])` for DRF FBVs.
 */

export class DjangoRouteScanner implements IRouteScanner {
  readonly framework = "django" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "django";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const out: ParsedRoute[] = [];
    const projectRoot = effectiveProjectRoot(match);
    const processed = new Set<string>(); // absolute paths already processed.
    // 1) Root urls.py. Look at both root and the typical sub-app
    //    (`app/urls.py`, `config/urls.py`, `src/urls.py`, etc.).
    const candidatesRoot: string[] = [
      join(projectRoot, "urls.py"),
    ];
    // Django convention: `app/urls.py` if `manage.py` + `app/` exist.
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
    // 2) Look for urls.py in sub-apps (`<project>/<app>/urls.py`).
    //    Only process if it was NOT already included from the root.
    const subUrls = await findSubUrlsPy(projectRoot);
    for (const abs of subUrls) {
      if (processed.has(abs)) continue;
      processed.add(abs);
      const rel = abs.startsWith(projectRoot)
        ? abs.slice(projectRoot.length + 1).split("/").join("/")
        : abs;
      out.push(...(await parseUrlsPy(abs, rel, projectRoot, "", processed)));
    }
    return { routes: out };
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
    // Detect `path("prefix/", include(...))` on the same line:
    // extract the prefix and process it as include.
    for (const m of line.matchAll(PATH_RE)) {
      const pathTemplate = m[1] ?? "";
      const viewRef = m[2] ?? "";
      // If the viewRef is `include(...)` (not a view), it's not a
      // terminal route: treat it as nested include with this path as prefix.
      if (viewRef.startsWith("include") || viewRef.startsWith("views.")) {
        // `views.foo` is an FBV, not an include — fall through to the normal block.
        if (viewRef.startsWith("include")) {
          const includeMatch = ownRegex(INCLUDE_RE).exec(line);
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
      // Strip `.as_view` to detect the base class.
      const viewName = viewRef.replace(/\.as_view$/, "");
      const fullPath = joinRoutePath("/", parentPrefix, pathTemplate);
      // For DRF views (ViewSet), expand to `{list, retrieve, create, ...}`.
      // Detect the class inheritance in the views.py file of its module.
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
    // Top-level includes (without path-prefix).
    for (const m of line.matchAll(INCLUDE_RE)) {
      // Only process if it was not already consumed by PATH_RE.
      if (line.includes("path(") && line.indexOf("include(") > line.indexOf("path(")) {
        continue;
      }
      await processInclude(m, absPath, projectRoot, parentPrefix, processed, out);
    }
  }
  return out;
}

/**
 * Processes an include: resolves the sub-urls file and parses it
 * recursively with the accumulated prefix.
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
    // Convention: the last segment is the file name (typically `urls`);
    // the previous ones are the directory hierarchy.
    const candidates = [
      // e.g. `app.auth.urls` → `app/auth/urls.py`
      join(projectRoot, parts.join("/")) + ".py",
      // e.g. `app.users.urls` → `apps/users/urls.py` (DRF convention)
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
 * For DRF ViewSets, returns all the standard HTTP methods according to
 * the base class type.
 *
 * - `ModelViewSet` → GET (list, retrieve), POST (create), PUT/PATCH (update), DELETE.
 * - `ListCreateAPIView` → GET (list), POST (create).
 * - `RetrieveUpdateDestroyAPIView` → GET (retrieve), PUT/PATCH (update), DELETE.
 * - `RetrieveAPIView` → GET.
 * - `UpdateAPIView` → PUT/PATCH.
 * - `CreateAPIView` → POST.
 * - `DestroyAPIView` → DELETE.
 *
 * If the viewName is a class name (e.g. `UserListCreateView`), looks up
 * the `views.py` file that defines it and extracts the inheritance.
 *
 * For Function Based Views, returns ["get"] as a heuristic (overridden
 * with `@api_view([...])` if detected).
 */
async function expandViewSetMethods(
  viewName: string,
  projectRoot: string,
): Promise<string[]> {
  // Plain class (e.g. `UserListCreateView`): look up inheritance in views.py.
  if (/^[A-Z][\w]*$/.test(viewName)) {
    const baseClass = await findBaseClass(viewName, projectRoot);
    return methodsFromBaseClass(baseClass);
  }
  // Any name with `.` (e.g. `views.foo`) or lowercase (e.g. `foo`):
  // treat as FBV and look for `@api_view([...])` near `def foo`.
  const fnName = viewName.includes(".") ? viewName.split(".").pop() ?? "" : viewName;
  if (/^[a-z_][\w]*$/.test(fnName)) {
    return methodsFromFunctionView(fnName, projectRoot);
  }
  // Default: heuristic.
  return ["get"];
}

function methodsFromBaseClass(baseClass: string | null): string[] {
  if (!baseClass) return ["get"];
  if (baseClass.includes("ReadOnlyModelViewSet")) {
    return ["get"];
  }
  if (
    baseClass.includes("ModelViewSet") ||
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
 * Looks up a `views.py` file in `app/<x>/views.py` or `apps/<x>/views.py`
 * and returns the base class name of `className`.
 */
async function findBaseClass(
  className: string,
  projectRoot: string,
): Promise<string | null> {
  const candidates = [
    join(projectRoot, "app"),
    join(projectRoot, "apps"),
    join(projectRoot, "src"),
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
 * Looks up a `views.py` file with `def fnName` and returns the methods
 * from the adjacent `@api_view([...])`.
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
      // Look for `@api_view(['POST'])` followed by `def fnName`.
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

  async supports(
    _r: ParsedRoute,
    _m: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    return _m.framework === "django";
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile) return { endpointKey, fields: [] };
    const abs = join(rawProjectRoot(match), route.sourceFile);
    const dir = abs.substring(0, abs.lastIndexOf("/"));
    // 1) Find the viewName for this URI by reading urls.py.
    //    Pass the prefixChain too to disambiguate.
    const viewName = await findViewNameForUri(
      abs,
      route.uri,
      route.prefixChain ?? [],
    );
    if (!viewName) return { endpointKey, fields: [] };
    // 2) Read views.py and find `class viewName(...)` to extract
    //    `serializer_class = XSerializer`.
    const viewsPath = join(dir, "views.py");
    let serializerName: string | null = null;
    try {
      const viewsRaw = await readFile(viewsPath, "utf8");
      const viewsText = stripPyComments(viewsRaw);
      // Find the block of the viewName class. Strategy: split into class
      // blocks (each ends before the next `^class`). If it's the last
      // class, the block reaches the end of the file.
      const classBlocks: Array<{ name: string; body: string }> = [];
      const classStartRe = /^class\s+(\w+)/gm;
      let m: RegExpExecArray | null;
      const starts: Array<{ name: string; index: number }> = [];
      while ((m = classStartRe.exec(viewsText)) !== null) {
        starts.push({ name: m[1] ?? "", index: m.index });
      }
      // El cuerpo de una clase llega hasta donde empieza la siguiente.
      for (const [i, start] of starts.entries()) {
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
      // FBV fallback: if viewName is lowercase (FBV), look for serializers
      // whose name contains the capitalised funcName.
      if (!serializerName && /^[a-z][\w]*$/.test(viewName)) {
        const capitalized = viewName.charAt(0).toUpperCase() + viewName.slice(1);
        try {
          const serRaw = await readFile(join(dir, "serializers.py"), "utf8");
          // Look for `class XYZSerializer` where XYZ contains `capitalized`.
          const match = new RegExp(
            `class\\s+(\\w*${capitalized}\\w*Serializer)\\b`,
            "m",
          );
          const m = match.exec(serRaw);
          if (m) serializerName = m[1] ?? null;
        } catch {
          // serializers.py doesn't exist.
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
 * Reads the urls.py file of the dir and returns the view name
 * (class or function) matching the given URI.
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
  // URI comes with the prefix already included. Strip the first prefix
  // to compare against the sub-urls.py's pathTemplate.
  // Both sides are compared without the leading slash: the URI comes in
  // since scanners emit absolute routes, but prefixChain stores the
  // prefix as declared by `include(...)`, without it.
  const stripLeadingSlash = (value: string): string => value.replace(/^\/+/, "");
  let relative = stripLeadingSlash(uri);
  if (prefixChain.length > 0) {
    const firstPrefix = stripLeadingSlash(prefixChain[0] ?? "");
    if (firstPrefix && relative.startsWith(firstPrefix)) {
      relative = relative.slice(firstPrefix.length);
    }
  }
  // `{{id}}` → `<id>` (no `:` type) to compare with Django.
  relative = relative.replace(/\{\{(\w+)\}\}/g, "<$1>");
  // Also normalise `<int:id>` → `<id>` (in case the uri still has the
  // Django form because it came directly from the scanner).
  relative = relative.replace(/<\w+:(\w+)>/g, "<$1>");
  // Strip the trailing slash for comparison.
  relative = relative.replace(/\/+$/, "");
  // If relative is empty (list), look for path("").
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
    for (const m of line.matchAll(PATH_RE)) {
      const pathTemplate = (m[1] ?? "").replace(/^\/+|\/+$/g, "");
      const viewRef = (m[2] ?? "").replace(/\.as_view$/, "");
      // Normalise the pathTemplate: `<int:id>` → `<id>` to match.
      const pathNormalized = pathTemplate.replace(/<\w+:(\w+)>/g, "<$1>");
      // Strip the trailing slash on pathNormalized too.
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
    // Trim the block up to the next `class` (or end of file).
    const afterCls = text.slice(clsIdx);
    const nextClass = afterCls.search(/\nclass\s+\w+/);
    const block =
      nextClass > 0 ? afterCls.slice(0, nextClass) : afterCls;
    const fields: IValidationSpec[] = [];
    // 1) `fields = [...]` in Meta.
    const metaFields = /Meta\s*:[\s\S]*?fields\s*=\s*\[([^\]]+)\]/.exec(block);
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
    // 3) Emit fields.
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
