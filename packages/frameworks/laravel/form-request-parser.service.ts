/**
 * Service to parse Laravel FormRequests and extract their validation
 * rules (`rules()`). From those rules it generates:
 *
 *   - A "minimum" example body (only required and typed fields).
 *   - A "complete" example body (all optional fields too).
 *   - Query-param variants for search GET endpoints.
 *
 * Limitations:
 * - Only literal rules (`['required', 'string', ...]`) are processed.
 *   Dynamic rules (`Rule::when(...)`, conditional rules with
 *   `$this->user()`, etc.) are IGNORED and reported as warnings.
 * - `foo.*` (nested) rules are IGNORED for auto-generation but are
 *   listed under `unknown`.
 *
 * The generated body is an EXAMPLE. The user can edit it in the
 * catalog for special cases.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { stripComments } from "./route-parser.service.js";
import type { BodyVariant, FormRequestRules, QueryVariant } from "../../contracts/interfaces/frameworks/scanners.interface.js";

const METHOD_RULES_RE = /public\s+function\s+rules\s*\([^)]*\)\s*:\s*array\s*\{/;

function extractRulesBlock(src: string): string | null {
  const startIdx = src.search(METHOD_RULES_RE);
  if (startIdx === -1) return null;
  const tail = src.slice(startIdx);

  // Find the first `return [` or `return[`.
  const retMatch = tail.match(/return\s*[\[({]/);
  if (!retMatch) return null;
  const openChar = retMatch[0].slice(-1);
  if (openChar !== "[") return null;

  // Position right after `return ` (or where the `[` is).
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
  // Both groups are required in the pattern, but the compiler doesn't
  // know that: checking costs one line and saves two `!`.
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
  // Find ALL occurrences of `'field' =>` and their positions.
  const fieldRe = /['"]([^'"]+)['"]\s*=>\s*/g;
  const found: Array<{ field: string; rhsStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(body)) !== null) {
    const field = m[1];
    if (field === undefined) continue;
    // Start of the value: right after `=> `
    found.push({ field, rhsStart: m.index + m[0].length });
  }
  // The RHS of a field ends where the next `'field' =>` begins
  // (the separating `,` is eaten by the next regex's match).
  //
  // Before, this was an index loop that **mutated** the elements
  // already pushed into the array (`matches[i].rhsEnd = end`),
  // reading `matches[i]` and `matches[i + 1]` without anything
  // guaranteeing they existed. Mapping leaves the same calculation
  // without loose indexes or mutation.
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
  context: IProjectContext,
): Promise<FormRequestRules> {
  const abs = join(context.projectRoot, relPath);
  const raw = await readFile(abs, "utf8");
  const text = stripComments(raw);

  // Accepts FormRequest directly or any subclass (IndexRequest,
  // StoreRequest, UpdateRequest, etc.). Only the parent class name has
  // to end in FormRequest.
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

// --- Generation of example values ------------------------------------

const TYPED_RULES = new Set([
  "string", "email", "url", "uuid", "ip", "mac_address",
  "date", "date_format", "integer", "int", "numeric",
  "boolean", "bool", "array", "json",
]);

export function detectTypedRule(rules: string[]): string | null {
  for (const r of rules) {
// `split` always returns at least one element, but the type doesn't
  // say so. `?? r` is the same value it would give in that case.
    const name = r.split(":")[0] ?? r;
    if (TYPED_RULES.has(name)) return r;
  }
  return null;
}

export function exampleValueForRule(rule: string, fieldName: string): unknown {
  const [name, ...args] = rule.split(":");
  switch (name) {
    // Each format has its own example. Before, all of them fell into the
    // same branch as `date`, so an `email` came out as "2024-01-15"
    // and the example body was unusable without manual editing.
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

/** Body with only the required fields (minimum viable). */
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
    // Required without explicit type: example string (better than omitting).
    const inRule = fieldRules.find((r) => r.startsWith("in:"));
    if (inRule) {
      out[field] = exampleValueForRule(inRule, field);
    } else {
      out[field] = `sample_${field}`;
    }
  }
  return out;
}

/** Body with all fields (required + sometimes), plausible values. */
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
 * Body variants from a FormRequest.
 *
 * Generates:
 *   - Minimum (required only)
 *   - Complete (all typed fields)
 *   - One variant per `in:a,b,c` (enum) field with each option
 *     (cap 6 per field to avoid blowing up the cartesian product)
 *   - Empty `{}` if there are no required (useful for partial PUTs)
 */
export function generateBodyVariants(rules: FormRequestRules): BodyVariant[] {
  const min = generateMinimalBody(rules);
  const full = generateCompleteBody(rules);
  const out: BodyVariant[] = [];

  if (Object.keys(min).length > 0) {
    out.push({ name: "Mínimo (solo required)", body: min });
  } else {
    // PUT/PATCH without required: empty body as a valid base.
    out.push({ name: "Empty (no required fields)", body: {} });
  }

  if (Object.keys(full).length > 0) {
    const hasExtra = Object.keys(full).length > Object.keys(min).length;
    if (hasExtra || Object.keys(min).length === 0) {
      out.push({ name: "Completo (todos los campos)", body: full });
    }
  }

  // Variants by enum `in:opt1,opt2,...` (max 3 fields × 4 options).
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

  // Deduplicate by body JSON.
  const seen = new Set<string>();
  return out.filter((v) => {
    const k = JSON.stringify(v.body);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --- Query-param variants -------------------------------------------

const QUERY_LIKE_FIELDS = new Set([
  "nombre", "razon_social", "cif", "codigo", "busqueda", "search", "q",
]);

/**
 * Generates query-param variants from the rules.
 * Useful for list/search GET endpoints (IndexXxxRequest).
 */
export function generateQueryVariants(rules: FormRequestRules): QueryVariant[] {
  if (rules.isEmpty) return [];
  const variants: QueryVariant[] = [];

  // "Basic" variant: a typical like field if one exists.
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

  // "All filters" variant: every filter as query params.
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
 * Given a controller namespace `App\Http\Controllers\X\YController`
 * and a method name, looks up the FormRequest associated by naming
 * convention in `app/Http/Requests/` (first the controller's
 * subfolder, then the whole tree).
 *
 * Returns the project-relative path (`app/Http/Requests/...php`) or
 * null.
 */
export async function findFormRequestForController(
  controllerClass: string,
  methodName: string,
  context: IProjectContext,
): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // `projectRootOverride` is the preferred path: it keeps the provider
  // reentrant (two projects scanned in the same process don't step
  // on each other). Before, without it, we fell back to the
  // `paths.service` singleton (removed in r00010 S2, 2026-09-03),
  // which resolved the root once per process from
  // POSTMAN_PROJECT_ROOT / --project-root.
  const base = path.join(context.projectRoot, "app", "Http", "Requests");

  const toRelative = (abs: string): string =>
    path.relative(context.projectRoot, abs).split(path.sep).join("/");

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
  // camelCase of the method itself: buscaMotorizaciones → BuscaMotorizacionesRequest
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

  // 1) Controller subdirs
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