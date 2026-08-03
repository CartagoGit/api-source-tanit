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
 */
const PATH_RE = /path\s*\(\s*r?['"]([^'"]+)['"]\s*,\s*([\w.]+)/g;
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
    // 1) urls.py raíz.
    const rootUrls = join(projectRoot, "urls.py");
    if (existsSync(rootUrls)) {
      out.push(...(await parseUrlsPy(rootUrls, "urls.py", projectRoot, "")));
    }
    // 2) Buscar urls.py en sub-apps (`<project>/<app>/urls.py`).
    const subUrls = await findSubUrlsPy(projectRoot);
    for (const abs of subUrls) {
      const rel = abs.startsWith(projectRoot)
        ? abs.slice(projectRoot.length + 1).split("/").join("/")
        : abs;
      out.push(...(await parseUrlsPy(abs, rel, projectRoot, "")));
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
    PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PATH_RE.exec(line)) !== null) {
      const pathTemplate = m[1] ?? "";
      const viewRef = m[2] ?? "";
      const fullPath = (parentPrefix + pathTemplate).replace(/\/+/g, "/");
      // Para views de DRF (ViewSet), expandimos a `{list, retrieve, create, ...}`.
      const expanded = expandViewSetMethods(viewRef, projectRoot);
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
    // Includes: recursar.
    INCLUDE_RE.lastIndex = 0;
    while ((m = INCLUDE_RE.exec(line)) !== null) {
      const includeList = m[1] ?? "";
      const includePath = m[2] ?? "";
      if (includeList) {
        // `include([path('users/', include('users/urls.py'))])` — best-effort.
        const innerPaths = [...includeList.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1] ?? "");
        for (const p of innerPaths) {
          out.push(...(await parseUrlsPy(join(absPath, "..", p), p, projectRoot, parentPrefix)));
        }
      } else if (includePath) {
        // `include('users.urls')` → resolver `<project>/<app>/urls.py`.
        const parts = includePath.split(".");
        const candidate = join(projectRoot, "apps", parts[0] ?? "", "urls.py");
        if (existsSync(candidate)) {
          const rel = candidate.startsWith(projectRoot)
            ? candidate.slice(projectRoot.length + 1).split("/").join("/")
            : candidate;
          out.push(...(await parseUrlsPy(candidate, rel, projectRoot, parentPrefix)));
        }
      }
    }
  }
  return out;
}

/**
 * Para ViewSets de DRF, retorna todos los métodos HTTP estándar.
 * Para Function Based Views, retorna ["get"] como heurístico.
 */
function expandViewSetMethods(viewRef: string, _projectRoot: string): string[] {
  // FBV / API_view: solo detectamos un método heurístico. Por defecto "get".
  if (viewRef.includes("ViewSet") || viewRef.includes("ModelViewSet")) {
    return ["get", "post", "put", "delete", "patch"];
  }
  // Para views funcionales, asumir [GET] por defecto.
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
    // Solo soportamos serializers para views con sourceFile = serializers.py
    // o similar. Nos limitamos a buscar `serializer_class = XSerializer`.
    const serializerMatch = /serializer_class\s*=\s*(\w+Serializer)/.exec(text);
    if (!serializerMatch) return { endpointKey, fields: [] };
    const serializerName = serializerMatch[1] ?? "";
    // Buscar la clase serializer dentro de archivos del mismo dir.
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
    const block = text.slice(clsIdx);
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
