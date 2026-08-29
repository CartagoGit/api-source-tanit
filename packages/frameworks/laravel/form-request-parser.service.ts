/**
 * Servicio para parsear FormRequests de Laravel y extraer sus reglas de
 * validación (`rules()`). A partir de esas reglas genera:
 *
 *   - Un body de ejemplo "mínimo" (solo campos required y tipados).
 *   - Un body de ejemplo "completo" (todos los campos opcionales también).
 *   - Variantes de query params para endpoints GET de búsqueda.
 *
 * Limitaciones:
 * - Solo procesa reglas literales (`['required', 'string', ...]`). Las
 *   reglas dinámicas (`Rule::when(...)`, reglas condicionales con
 *   `$this->user()`, etc.) se IGNORAN y se documentan como advertencia.
 * - Las reglas `algo.*` (anidadas) se IGNORAN para la generación
 *   automática pero se listan en `unknown`.
 *
 * El body generado es un EJEMPLO. El usuario puede editarlo en el
 * catálogo para casos especiales.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stripComments } from "./route-parser.service.js";
import { fromProjectRelative, requestsDir } from "../../core/discovery/paths.service.js";
import type { BodyVariant, FormRequestRules, QueryVariant } from "../../contracts/interfaces/frameworks/scanners.interface.js";

const METHOD_RULES_RE = /public\s+function\s+rules\s*\([^)]*\)\s*:\s*array\s*\{/;

function extractRulesBlock(src: string): string | null {
  const startIdx = src.search(METHOD_RULES_RE);
  if (startIdx === -1) return null;
  const tail = src.slice(startIdx);

  // Encontrar el primer `return [` o `return[`.
  const retMatch = tail.match(/return\s*[\[({]/);
  if (!retMatch) return null;
  const openChar = retMatch[0].slice(-1);
  if (openChar !== "[") return null;

  // Posición justo después de `return ` (o justo donde está el `[`).
  const openIdx = retMatch.index! + retMatch[0].length - 1;

  let depth = 0;
  let inString: string | null = null;
  for (let i = openIdx; i < tail.length; i++) {
    const c = tail[i];
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"') {
      inString = c;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        return tail.slice(retMatch.index!, i + 1);
      }
    }
  }
  return null;
}

function parseRulePair(text: string): { field: string; rules: string[]; unknown: string[] } | null {
  const m = text.match(/^\s*['"]([^'"]+)['"]\s*=>\s*(.+?)(?=,\s*(?:['"][^'"]+['"]\s*=>)|$)/s);
  if (!m) return null;
  // Los dos grupos son obligatorios en el patrón, pero eso el compilador
  // no lo sabe: comprobarlos cuesta una línea y quita dos `!`.
  const [, field, rawRhs] = m;
  if (field === undefined || rawRhs === undefined) return null;
  const rhs = rawRhs.trim().replace(/,?\s*$/, "");
  const rules: string[] = [];
  const unknown: string[] = [];

  if (/^['"][^'"]*['"]$/.test(rhs) && rhs.includes("|")) {
    for (const r of rhs.slice(1, -1).split("|")) {
      if (r) rules.push(r);
    }
    return { field, rules, unknown };
  }

  let inner = rhs;
  if (inner.startsWith("[") && inner.endsWith("]")) {
    inner = inner.slice(1, -1);
  }
  const items: string[] = [];
  let buf = "";
  let inStr: string | null = null;
  let nested = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      buf += c;
      if (c === "\\") {
        buf += inner[++i] ?? "";
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"') {
      inStr = c;
      buf += c;
      continue;
    }
    if (c === "[") {
      nested++;
      buf += c;
      continue;
    }
    if (c === "]") {
      nested--;
      buf += c;
      continue;
    }
    if (c === "," && nested === 0) {
      if (buf.trim()) items.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) items.push(buf.trim());

  for (const item of items) {
    const strLit = item.match(/^['"]([^'"]+)['"]$/)?.[1];
    if (strLit !== undefined) {
      rules.push(strLit);
      continue;
    }
    if (/^Rule::/.test(item) || /^new\s/.test(item)) {
      unknown.push(item);
      continue;
    }
    if (item.startsWith("[") && item.endsWith("]")) {
      const inner = item.slice(1, -1);
      for (const r of inner.split(",")) {
        const s = r.trim().match(/^['"]([^'"]+)['"]$/)?.[1];
        if (s !== undefined) rules.push(s);
        else unknown.push(r.trim());
      }
      continue;
    }
    unknown.push(item);
  }
  return { field, rules, unknown };
}

function parseRulesArray(block: string): { rules: Record<string, string[]>; unknown: Array<{ field: string; rule: string }> } {
  const rules: Record<string, string[]> = {};
  const unknown: Array<{ field: string; rule: string }> = [];
  let body = block.replace(/^\s*return\s*/, "").trim();
  if (body.startsWith("[") && body.endsWith("]")) {
    body = body.slice(1, -1);
  }
  // Encontrar TODAS las apariciones de `'campo' =>` y sus posiciones.
  const fieldRe = /['"]([^'"]+)['"]\s*=>\s*/g;
  const found: Array<{ field: string; rhsStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(body)) !== null) {
    const field = m[1];
    if (field === undefined) continue;
    // Inicio del valor: justo después de `=> `
    found.push({ field, rhsStart: m.index + m[0].length });
  }
  // El RHS de un campo acaba donde empieza el siguiente `'campo' =>`
  // (el `,` que los separa se lo come el regex del siguiente).
  //
  // Antes esto era un bucle por índice que **mutaba** los elementos ya
  // metidos en el array (`matches[i].rhsEnd = end`), leyendo `matches[i]`
  // y `matches[i + 1]` sin que nada garantizara que existieran. Mapear
  // deja el mismo cálculo sin índices sueltos ni mutación.
  const matches = found.map((current, i) => {
    const next = found[i + 1];
    if (!next) return { ...current, rhsEnd: body.length };
    const sep = body.indexOf(`, '${next.field}'`, current.rhsStart);
    return { ...current, rhsEnd: sep === -1 ? body.length : sep };
  });
  for (const { field, rhsStart, rhsEnd } of matches) {
    const rhs = body.slice(rhsStart, rhsEnd).trim().replace(/,\s*$/, "");
    const pair = parseRulePair(`'${field}' => ${rhs}`);
    if (pair) {
      rules[field] = pair.rules;
      for (const u of pair.unknown) unknown.push({ field, rule: u });
    }
  }
  return { rules, unknown };
}

export async function parseFormRequest(
  relPath: string,
  projectRootOverride?: string,
): Promise<FormRequestRules> {
  const abs = projectRootOverride
    ? join(projectRootOverride, relPath)
    : fromProjectRelative(relPath);
  const raw = await readFile(abs, "utf8");
  const text = stripComments(raw);

  // Acepta FormRequest directo o cualquier subclase (IndexRequest,
  // StoreRequest, UpdateRequest, etc.). Basta con que el nombre de la
  // clase padre termine en FormRequest.
  const classMatch = text.match(/class\s+(\w+)\s+extends\s+\w*FormRequest/);
  const className = classMatch?.[1] ?? "(unknown)";

  const block = extractRulesBlock(text);
  if (!block) {
    return { sourceFile: relPath, className, rules: {}, unknown: [], isEmpty: true };
  }

  const { rules, unknown } = parseRulesArray(block);
  const isEmpty = Object.keys(rules).length === 0 && unknown.length === 0;
  return { sourceFile: relPath, className, rules, unknown, isEmpty };
}

// --- Generación de valores de ejemplo ------------------------------------

const TYPED_RULES = new Set([
  "string", "email", "url", "uuid", "ip", "mac_address",
  "date", "date_format", "integer", "int", "numeric",
  "boolean", "bool", "array", "json",
]);

export function detectTypedRule(rules: string[]): string | null {
  for (const r of rules) {
    // `split` siempre devuelve al menos un elemento, pero el tipo no lo
    // dice. `?? r` es el mismo valor que daría en ese caso.
    const name = r.split(":")[0] ?? r;
    if (TYPED_RULES.has(name)) return r;
  }
  return null;
}

export function exampleValueForRule(rule: string, fieldName: string): unknown {
  const [name, ...args] = rule.split(":");
  switch (name) {
    // Cada formato tiene su ejemplo. Antes todos caían en la misma rama
    // que `date`, así que un `email` salía como "2024-01-15" y el body de
    // ejemplo era inservible sin editarlo a mano.
    case "email":
      return "user@example.com";
    case "url":
    case "active_url":
      return "https://example.com";
    case "uuid":
      return "00000000-0000-0000-0000-000000000001";
    case "ip":
    case "ipv4":
      return "192.0.2.1";
    case "ipv6":
      return "2001:db8::1";
    case "mac_address":
      return "00:1a:2b:3c:4d:5e";
    case "json":
      return "{}";
    case "date":
      return "2024-01-15";
    case "string":
      return `sample_${fieldName}`;
    case "date_format": {
      const fmt = args.join(":");
      if (fmt.includes("Y-m-d") && fmt.includes("H:i:s")) return "2024-01-15 10:00:00";
      if (fmt.includes("Y-m-d")) return "2024-01-15";
      return `sample_${fieldName}`;
    }
    case "integer":
    case "int":
      return 1;
    case "numeric":
      return 1;
    case "boolean":
    case "bool":
      return true;
    case "array":
      return ["elemento1"];
    case "file":
    case "image":
    case "mimes":
      return "(file)";
    case "in":
      return args[0]?.split(",")[0]?.replace(/['"]/g, "") ?? "option1";
    default:
      return null;
  }
}

function isRequired(rules: string[]): boolean {
  return rules.includes("required");
}

function isNestedWildcard(field: string): boolean {
  return field.includes(".*");
}

/** Body con solo los campos required (mínimo viable). */
export function generateMinimalBody(rules: FormRequestRules): Record<string, unknown> {
  if (rules.isEmpty) return {};
  const out: Record<string, unknown> = {};
  for (const [field, fieldRules] of Object.entries(rules.rules)) {
    if (isNestedWildcard(field)) continue;
    if (!isRequired(fieldRules)) continue;
    const typed = detectTypedRule(fieldRules);
    if (typed) {
      out[field] = exampleValueForRule(typed, field);
      continue;
    }
    // required sin tipo explícito: string de ejemplo (mejor que omitir).
    const inRule = fieldRules.find((r) => r.startsWith("in:"));
    if (inRule) {
      out[field] = exampleValueForRule(inRule, field);
    } else {
      out[field] = `sample_${field}`;
    }
  }
  return out;
}

/** Body con todos los campos (required + sometimes), valores plausibles. */
export function generateCompleteBody(rules: FormRequestRules): Record<string, unknown> {
  if (rules.isEmpty) return {};
  const out: Record<string, unknown> = {};
  for (const [field, fieldRules] of Object.entries(rules.rules)) {
    if (isNestedWildcard(field)) continue;
    const typed = detectTypedRule(fieldRules);
    if (typed) {
      out[field] = exampleValueForRule(typed, field);
      continue;
    }
    const inRule = fieldRules.find((r) => r.startsWith("in:"));
    if (inRule) out[field] = exampleValueForRule(inRule, field);
    else if (isRequired(fieldRules) || fieldRules.includes("sometimes")) {
      out[field] = `sample_${field}`;
    }
  }
  return out;
}

/**
 * Variantes de body a partir de un FormRequest.
 *
 * Genera:
 *   - Mínimo (solo required)
 *   - Completo (todos los campos tipados)
 *   - Una variante por cada campo `in:a,b,c` (enum) con cada opción
 *     (tope 6 por campo para no explotar el producto cartesiano)
 *   - Vacío `{}` si no hay required (útil para PUT parciales)
 */
export function generateBodyVariants(rules: FormRequestRules): BodyVariant[] {
  const min = generateMinimalBody(rules);
  const full = generateCompleteBody(rules);
  const out: BodyVariant[] = [];

  if (Object.keys(min).length > 0) {
    out.push({ name: "Mínimo (solo required)", body: min });
  } else {
    // PUT/PATCH sin required: body vacío como base válida.
    out.push({ name: "Empty (no required fields)", body: {} });
  }

  if (Object.keys(full).length > 0) {
    const hasExtra = Object.keys(full).length > Object.keys(min).length;
    if (hasExtra || Object.keys(min).length === 0) {
      out.push({ name: "Completo (todos los campos)", body: full });
    }
  }

  // Variantes por enum `in:opt1,opt2,...` (máx. 3 campos × 4 opciones).
  let enumFields = 0;
  for (const [field, fieldRules] of Object.entries(rules.rules)) {
    if (isNestedWildcard(field)) continue;
    if (enumFields >= 3) break;
    const inRule = fieldRules.find((r) => r.startsWith("in:"));
    if (!inRule) continue;
    const opts = inRule
      .slice(3)
      .split(",")
      .map((o) => o.replace(/['"]/g, "").trim())
      .filter(Boolean)
      .slice(0, 4);
    if (opts.length < 2) continue;
    enumFields += 1;
    for (const opt of opts) {
      const body = { ...min, [field]: opt };
      out.push({ name: `Enum ${field}=${opt}`, body });
    }
  }

  // Deduplicar por JSON del body.
  const seen = new Set<string>();
  return out.filter((v) => {
    const k = JSON.stringify(v.body);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --- Variantes de query params -------------------------------------------

const QUERY_LIKE_FIELDS = new Set([
  "nombre", "razon_social", "cif", "codigo", "busqueda", "search", "q",
]);

/**
 * Genera variantes de query params a partir de las reglas.
 * Útil para endpoints GET de listado/búsqueda (IndexXxxRequest).
 */
export function generateQueryVariants(rules: FormRequestRules): QueryVariant[] {
  if (rules.isEmpty) return [];
  const variants: QueryVariant[] = [];

  // Variante "Básica": un campo like típico si existe.
  const likeField = Object.entries(rules.rules).find(([f, rs]) =>
    QUERY_LIKE_FIELDS.has(f) && detectTypedRule(rs) !== null,
  );
  if (likeField) {
    variants.push({
      name: "Básica (un filtro)",
      query: [{
        key: likeField[0],
        value: "ejemplo",
        description: `Filtro ${likeField[0]}`,
      }],
    });
  }

  // Variante "Todos": todos los filtros como query params.
  const all: QueryVariant["query"] = [];
  for (const [field, fieldRules] of Object.entries(rules.rules)) {
    if (isNestedWildcard(field)) continue;
    const typed = detectTypedRule(fieldRules);
    if (!typed) continue;
    const val = exampleValueForRule(typed, field);
    if (val === null || val === "(file)") continue;
    const isArray = typed.startsWith("array");
    all.push({
      key: field,
      value: isArray ? "valor1,valor2" : String(val),
      description: fieldRules.slice(0, 3).join("|"),
    });
  }
  if (all.length > 0) {
    variants.push({ name: "All filters", query: all });
  }
  return variants;
}

/**
 * Dado un namespace de controlador `App\Http\Controllers\X\YController`
 * y un nombre de método, busca el FormRequest asociado por convención
 * de nombre en `app/Http/Requests/` (primero subcarpeta del controlador,
 * luego todo el árbol).
 *
 * Devuelve ruta relativa al proyecto (`app/Http/Requests/...php`) o null.
 */
export async function findFormRequestForController(
  controllerClass: string,
  methodName: string,
  projectRootOverride?: string,
): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { toProjectRelative } = await import("../../core/discovery/paths.service.js");

  // `projectRootOverride` es el camino preferente: mantiene el provider
  // reentrante (dos proyectos escaneados en el mismo proceso no se pisan).
  // Sin él caemos al singleton de `paths.service`, que resuelve la raíz
  // una única vez por proceso desde POSTMAN_PROJECT_ROOT / --project-root.
  const base = projectRootOverride
    ? path.join(projectRootOverride, "app", "Http", "Requests")
    : requestsDir();
  if (!base) return null;

  const toRelative = (abs: string): string =>
    projectRootOverride
      ? path.relative(projectRootOverride, abs).split(path.sep).join("/")
      : toProjectRelative(abs);

  const ctrlSegs = controllerClass.split("\\").filter(Boolean);
  // App Http Controllers [Sub?] NameController
  const afterControllers = ctrlSegs.slice(
    ctrlSegs.findIndex((s) => s === "Controllers") + 1,
  );
  const controllerFile = afterControllers[afterControllers.length - 1] ?? "";
  const resourceHint = controllerFile
    .replace(/Controller$/, "")
    .replace(/s$/, "");
  const subDirs = afterControllers.slice(0, -1);

  const methodMap: Record<string, string[]> = {
    index: ["Index", "Listar", "Lista", "List"],
    show: ["Show", "Ver", "Get"],
    store: ["Store", "Create", "Crear", "Nuevo", "Nueva"],
    update: ["Update", "Edit", "Editar", "Actualizar"],
    destroy: ["Destroy", "Delete", "Eliminar"],
    delete: ["Delete", "Destroy", "Eliminar"],
  };
  const prefixes = methodMap[methodName] ?? [
    methodName.charAt(0).toUpperCase() + methodName.slice(1),
  ];

  const candidateClassNames = new Set<string>();
  for (const pfx of prefixes) {
    candidateClassNames.add(`${pfx}Request`);
    if (resourceHint) {
      candidateClassNames.add(`${pfx}${resourceHint}Request`);
      candidateClassNames.add(`${pfx}${resourceHint}sRequest`);
      candidateClassNames.add(`${pfx}${controllerFile.replace(/Controller$/, "")}Request`);
    }
  }
  // camelCase del propio método: buscaMotorizaciones → BuscaMotorizacionesRequest
  const camel =
    methodName.charAt(0).toUpperCase() + methodName.slice(1) + "Request";
  candidateClassNames.add(camel);

  async function scanDir(dir: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let entries: string[];
    try {
      entries = await fs.readdir(dir, { recursive: true });
    } catch {
      return map;
    }
    for (const entry of entries) {
      if (!String(entry).endsWith("Request.php")) continue;
      const abs = path.resolve(dir, entry);
      const cls = path.basename(String(entry), ".php");
      if (!map.has(cls)) map.set(cls, abs);
    }
    return map;
  }

  // 1) Subdirs del controlador
  const searchRoots: string[] = [];
  if (subDirs.length) searchRoots.push(path.join(base, ...subDirs));
  if (resourceHint) searchRoots.push(path.join(base, resourceHint));
  searchRoots.push(base);

  const seen = new Set<string>();
  for (const root of searchRoots) {
    if (seen.has(root)) continue;
    seen.add(root);
    const byClass = await scanDir(root);
    for (const name of candidateClassNames) {
      const abs = byClass.get(name);
      if (abs) return toRelative(abs);
    }
  }
  return null;
}