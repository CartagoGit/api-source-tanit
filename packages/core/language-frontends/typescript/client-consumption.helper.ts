import { getBindingIdentifiers, isFunction, VISITOR_KEYS } from "@babel/types";
import type {
  CallExpression,
  ImportDeclaration,
  Node,
  ObjectExpression,
  OptionalCallExpression,
  Program,
} from "@babel/types";

import { SUPPORTED_METHODS } from "../../../contracts/constants/core/postman.constant.js";
import type {
  ClientUnresolvedReason,
  IClientConsumptionOptions,
  IClientUsage,
} from "../../../contracts/interfaces/core/client-consumption.interface.js";
import { collectMethodCallsFromProgram } from "../../language-ir/collect-method-calls.helper.js";
import { parseWithProgram } from "./typescript.parser.js";

interface ICachedProgram {
  readonly program: Program;
  readonly errors?: readonly unknown[];
}

interface IBinding {
  readonly node: Node;
  readonly init?: Node;
  readonly source?: string;
  readonly axios?: boolean;
}

interface IScope {
  readonly parent?: IScope;
  readonly bindings: Map<string, IBinding[]>;
  readonly functionBoundary: boolean;
}

interface ICallSite {
  readonly node: CallExpression | OptionalCallExpression;
  readonly scope: IScope;
}

interface IRequest {
  readonly url?: Node;
  readonly method?: string;
  readonly reason?: ClientUnresolvedReason;
}

function bindings(scope: IScope | undefined, name: string): readonly IBinding[] {
  for (let current = scope; current; current = current.parent) {
    const found = current.bindings.get(name);
    if (found) return found;
  }
  return [];
}

function bind(scope: IScope, name: string, binding: IBinding): void {
  const found = scope.bindings.get(name) ?? [];
  found.push(binding);
  scope.bindings.set(name, found);
}

function isAxiosRequire(node: Node | undefined): boolean {
  return node?.type === "CallExpression" &&
    node.callee.type === "Identifier" && node.callee.name === "require" &&
    node.arguments.length === 1 &&
    node.arguments[0]?.type === "StringLiteral" && node.arguments[0].value === "axios";
}

function bindPattern(scope: IScope, pattern: Node, binding: IBinding): void {
  const target = pattern.type === "TSParameterProperty" ? pattern.parameter : pattern;
  for (const name of Object.keys(getBindingIdentifiers(target))) bind(scope, name, binding);
}

function bindImports(node: ImportDeclaration, scope: IScope, axiosNames: Set<string>): void {
  if (node.importKind === "type") return;
  for (const specifier of node.specifiers) {
    if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;
    const axios = node.source.value === "axios" && (
      specifier.type !== "ImportSpecifier" ||
      (specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value) === "default"
    );
    bind(scope, specifier.local.name, { node: specifier, source: node.source.value, axios });
    if (axios) axiosNames.add(specifier.local.name);
  }
}

function registerDeclarations(node: Node, scope: IScope, axiosNames: Set<string>): void {
  switch (node.type) {
    case "ImportDeclaration":
      bindImports(node, scope, axiosNames);
      break;
    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "TSDeclareFunction":
    case "TSEnumDeclaration":
    case "TSModuleDeclaration":
      if (node.id?.type === "Identifier") bind(scope, node.id.name, { node });
      break;
    case "TSImportEqualsDeclaration":
      if (node.importKind !== "type") bind(scope, node.id.name, { node });
      break;
    case "VariableDeclaration": {
      let target = scope;
      while (node.kind === "var" && !target.functionBoundary && target.parent) target = target.parent;
      for (const declaration of node.declarations) {
        const init = node.kind === "const" && declaration.id.type === "Identifier"
          ? declaration.init ?? undefined
          : undefined;
        bindPattern(target, declaration.id, { node: declaration, init });
        if (declaration.id.type === "Identifier" && isAxiosRequire(init)) {
          axiosNames.add(declaration.id.name);
        }
      }
      break;
    }
  }
}

function callSites(program: Program): { sites: ICallSite[]; axiosNames: Set<string> } {
  const sites: ICallSite[] = [];
  const axiosNames = new Set<string>();
  const root: IScope = { bindings: new Map(), functionBoundary: true };

  function visit(node: Node, parentScope: IScope): void {
    registerDeclarations(node, parentScope, axiosNames);
    const functionBoundary = isFunction(node) || node.type === "StaticBlock" || node.type === "TSModuleBlock";
    const block = ["BlockStatement", "CatchClause", "ClassExpression", "ForStatement",
      "ForInStatement", "ForOfStatement", "SwitchStatement"].includes(node.type);
    const scope: IScope = functionBoundary || block
      ? { parent: parentScope, bindings: new Map(), functionBoundary }
      : parentScope;

    if (isFunction(node)) {
      for (const param of node.params) bindPattern(scope, param, { node: param });
      if (node.type === "FunctionExpression" && node.id) bind(scope, node.id.name, { node });
    }
    if (node.type === "ClassExpression" && node.id) bind(scope, node.id.name, { node });
    if (node.type === "CatchClause" && node.param) bindPattern(scope, node.param, { node: node.param });
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") sites.push({ node, scope });

    const fields = node as unknown as Record<string, Node | readonly Node[] | null | undefined>;
    for (const key of VISITOR_KEYS[node.type] ?? []) {
      const child = fields[key];
      if (Array.isArray(child)) {
        for (const item of child) if (item) visit(item, scope);
      } else if (child) {
        visit(child as Node, scope);
      }
    }
  }

  visit(program, root);
  return { sites, axiosNames };
}

function bindingScope(scope: IScope, name: string): IScope {
  let owner = scope;
  while (!owner.bindings.has(name) && owner.parent) owner = owner.parent;
  return owner;
}

function unwrap(node: Node | undefined): Node | undefined {
  while (node?.type === "TSAsExpression" || node?.type === "TSSatisfiesExpression" ||
    node?.type === "TSNonNullExpression" || node?.type === "TSTypeAssertion" ||
    node?.type === "ParenthesizedExpression") {
    node = node.expression;
  }
  return node;
}

function staticString(expression: Node | undefined, scope: IScope, depth = 0): string | undefined {
  const node = unwrap(expression);
  if (!node || depth > 24) return undefined;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "Identifier") {
    const found = bindings(scope, node.name);
    const binding = found[0];
    if (found.length !== 1 || !binding?.init || (binding.node.end ?? Infinity) > (node.start ?? -1)) {
      return undefined;
    }
    // Resolve the initializer in its declaration scope, where its identifiers are bound.
    return staticString(binding.init, bindingScope(scope, node.name), depth + 1);
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticString(node.left, scope, depth + 1);
    const right = staticString(node.right, scope, depth + 1);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (node.type === "TemplateLiteral") {
    let result = "";
    for (const [index, quasi] of node.quasis.entries()) {
      if (quasi.value.cooked == null) return undefined;
      result += quasi.value.cooked;
      if (index === node.expressions.length) break;
      const value = staticString(node.expressions[index], scope, depth + 1);
      if (value === undefined) return undefined;
      result += value;
    }
    return result;
  }
  return undefined;
}

function objectFields(node: ObjectExpression, scope: IScope): Map<string, Node> | undefined {
  const fields = new Map<string, Node>();
  for (const property of node.properties) {
    if (property.type !== "ObjectProperty") return undefined;
    const key = !property.computed && property.key.type === "Identifier"
      ? property.key.name
      : staticString(property.key, scope);
    if (key === undefined || key === "__proto__") return undefined;
    fields.set(key, property.value);
  }
  return fields;
}

function optionsFields(node: Node | undefined, scope: IScope): Map<string, Node> | undefined {
  const value = unwrap(node);
  if (!value || (value.type === "Identifier" && value.name === "undefined" &&
    bindings(scope, "undefined").length === 0)) return new Map();
  return value.type === "ObjectExpression" ? objectFields(value, scope) : undefined;
}

function requestMethod(node: Node | undefined, scope: IScope): string | undefined {
  if (!node) return "GET";
  const method = staticString(node, scope)?.toUpperCase();
  return method && /^[!#$%&'*+.^_`|~0-9A-Z-]+$/u.test(method) ? method : undefined;
}

function request(
  site: ICallSite,
  recognizer: IClientUsage["evidence"]["recognizer"],
  member?: string,
): IRequest {
  const [first, second, third] = site.node.arguments;
  const { scope } = site;
  if (first?.type === "SpreadElement") return { reason: "unknown-options" };

  if (recognizer === "fetch") {
    const fields = optionsFields(second, scope);
    if (!fields) return { url: first, reason: "unknown-options" };
    const method = requestMethod(fields.get("method"), scope);
    return { url: first, method, reason: method ? undefined : "dynamic-method" };
  }

  const verb = member?.toUpperCase();
  if (member !== undefined && member !== "request") {
    if (!SUPPORTED_METHODS.some((method) => method !== "ALL" && method.toLowerCase() === member)) {
      return { reason: "unsupported-call" };
    }
    if (recognizer === "configured-alias") return { url: first, method: verb };
    const options = ["post", "put", "patch"].includes(member) ? third : second;
    if (second?.type === "SpreadElement") return { url: first, method: verb, reason: "unknown-options" };
    const fields = optionsFields(options, scope);
    if (!fields || fields.has("baseURL") || fields.has("adapter")) {
      return { url: first, method: verb, reason: "unknown-options" };
    }
    return { url: first, method: verb };
  }

  if (recognizer === "configured-alias") return { reason: "unsupported-call" };
  const object = unwrap(first);
  const configOnly = object?.type === "ObjectExpression";
  if (!configOnly && second === undefined && staticString(first, scope) === undefined &&
    object && object.type !== "TemplateLiteral" && object.type !== "BinaryExpression") {
    return { reason: "unknown-options" };
  }
  const fields = optionsFields(configOnly ? first : second, scope);
  const url = configOnly ? fields?.get("url") : first;
  if (!fields || fields.has("baseURL") || fields.has("adapter") ||
    (configOnly ? second !== undefined : fields.has("url"))) return { url, reason: "unknown-options" };
  const method = requestMethod(fields.get("method"), scope);
  return { url, method, reason: method ? undefined : "dynamic-method" };
}

function recognize(
  site: ICallSite,
  members: ReadonlyMap<number, ReturnType<typeof collectMethodCallsFromProgram>[number]>,
  axiosNames: ReadonlySet<string>,
  aliases: IClientConsumptionOptions["aliases"],
): { recognizer: IClientUsage["evidence"]["recognizer"]; callee: string; member?: string; reason?: ClientUnresolvedReason } | undefined {
  const { node, scope } = site;
  const callee = node.callee;
  const ir = members.get(node.start ?? -1);
  if (callee.type === "Identifier" && callee.name === "fetch") {
    return { recognizer: "fetch", callee: "fetch",
      reason: bindings(scope, "fetch").length ? "shadowed-client" : undefined };
  }
  const memberCall = callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression";
  const receiver = callee.type === "Identifier" ? callee.name : ir?.receiver;
  if (!receiver) return undefined;
  const member = memberCall
    ? callee.computed ? staticString(callee.property, scope) : ir?.method
    : undefined;
  const spelling = ir?.callee ?? receiver;
  const active = bindings(scope, receiver);
  if (axiosNames.has(receiver) || receiver === "axios") {
    const binding = active.length === 1 ? active[0] : undefined;
    const localRequire = isAxiosRequire(binding?.init) &&
      bindings(bindingScope(scope, receiver), "require").length === 0 &&
      (binding?.node.end ?? Infinity) <= (node.start ?? -1);
    if (binding?.axios || localRequire) {
      return { recognizer: "axios", callee: spelling, member,
        reason: memberCall && !member ? "unsupported-call" : undefined };
    }
    // An unbound Axios spelling or a shadowed import is still useful evidence.
    return { recognizer: "axios", callee: spelling,
      reason: active.length ? "shadowed-client" : "unresolved-alias" };
  }
  const configured = aliases?.filter((alias) => alias.receiver === receiver);
  if (!configured?.length) return undefined;
  if (configured.some((alias) => alias.kind === "unsupported")) {
    return { recognizer: "configured-alias", callee: spelling, reason: "unsupported-call" };
  }
  const trusted = configured.some((alias) => alias.source === undefined
    ? active.length === 0
    : active.length === 1 && active[0]?.source === alias.source);
  return {
    recognizer: "configured-alias", callee: spelling, member,
    reason: !trusted ? "unresolved-alias" : !member ? "unsupported-call" : undefined,
  };
}

function scanProgram(program: Program, file: string, options: IClientConsumptionOptions): IClientUsage[] {
  const members = new Map(collectMethodCallsFromProgram(program, file).map((call) => [call.range.start, call]));
  const { sites, axiosNames } = callSites(program);
  const usages: IClientUsage[] = [];
  for (const site of sites) {
    const found = recognize(site, members, axiosNames, options.aliases);
    const { start, end, loc } = site.node;
    if (!found || !loc) continue;
    const observed = found.reason ? { reason: found.reason } : request(site, found.recognizer, found.member);
    const url = staticString(observed.url, site.scope);
    const unresolvedReason = observed.reason ?? (url === undefined ? "dynamic-url" : undefined);
    const staticUrl = url === undefined ? undefined : unwrap(observed.url)?.type === "StringLiteral" ? "literal" : "expression";
    usages.push({
      location: { file, line: loc.start.line, column: loc.start.column, start: start ?? undefined, end: end ?? undefined },
      evidence: { recognizer: found.recognizer, callee: found.callee, staticUrl },
      method: observed.method,
      url,
      confidence: unresolvedReason ? "low" : staticUrl === "literal" ? "high" : "medium",
      unresolvedReason,
    });
  }
  return usages.sort((left, right) => (left.location.start ?? 0) - (right.location.start ?? 0));
}

/** Scans the same parse tree supplied to the TypeScript LanguageIR collector. */
export function scanClientAst(ast: unknown, file: string, options: IClientConsumptionOptions): IClientUsage[] {
  const parsed = ast as ICachedProgram;
  if (parsed.errors?.length) throw new SyntaxError("Client source did not parse cleanly");
  return scanProgram(parsed.program, file, options);
}

/** Fallback for syntax that the current shared AST cache cannot parse, including decorators. */
export function scanClientSource(source: string, file: string, options: IClientConsumptionOptions): IClientUsage[] {
  return scanProgram(parseWithProgram(source, file).program as Program, file, options);
}
