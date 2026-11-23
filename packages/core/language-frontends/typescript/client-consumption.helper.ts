import { getBindingIdentifiers, isFunction, traverse } from "@babel/types";
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
  IAngularClientTemplateOwner,
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
  readonly node?: Node;
  readonly parent?: IScope;
  readonly bindings: Map<string, IBinding[]>;
  readonly functionBoundary: boolean;
}

interface ICallSite {
  readonly node: CallExpression | OptionalCallExpression;
  readonly scope: IScope;
}

interface IRequest {
  readonly jsonBody?: string;
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

function callSites(program: Program, templateScopes?: IScope[]): { sites: ICallSite[]; axiosNames: Set<string> } {
  const sites: ICallSite[] = [];
  const axiosNames = new Set<string>();
  let scope: IScope = { bindings: new Map(), functionBoundary: true };

  traverse(program, {
    enter(node) {
      registerDeclarations(node, scope, axiosNames);
      const functionBoundary = isFunction(node) || node.type === "StaticBlock" || node.type === "TSModuleBlock";
      const block = ["BlockStatement", "CatchClause", "ClassDeclaration", "ClassExpression", "ForStatement",
        "ForInStatement", "ForOfStatement", "SwitchStatement"].includes(node.type);
      if (functionBoundary || block) {
        scope = { node, parent: scope, bindings: new Map(), functionBoundary };
        if (node.type === "ClassDeclaration" || node.type === "ClassExpression") templateScopes?.push(scope);
      }

      if (isFunction(node)) {
        for (const param of node.params) bindPattern(scope, param, { node: param });
        if (node.type === "FunctionExpression" && node.id) bind(scope, node.id.name, { node });
      }
      if (node.type === "ClassExpression" && node.id) bind(scope, node.id.name, { node });
      if (node.type === "CatchClause" && node.param) bindPattern(scope, node.param, { node: node.param });
      if (node.type === "CallExpression" || node.type === "OptionalCallExpression") sites.push({ node, scope });
    },
    exit(node) {
      if (scope.node === node && scope.parent) scope = scope.parent;
    },
  });
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

function isNamedImport(
  node: Node | undefined,
  scope: IScope,
  source: string,
  exported: string,
): boolean {
  if (node?.type !== "Identifier") return false;
  const active = bindings(scope, node.name);
  if (active.length !== 1) return false;
  const [binding] = active;
  if (binding?.source !== source || binding.node.type !== "ImportSpecifier") return false;
  const { imported } = binding.node;
  return (imported.type === "Identifier" ? imported.name : imported.value) === exported;
}

function isAngularHttpClient(node: Node | undefined, scope: IScope): boolean {
  return isNamedImport(node, scope, "@angular/common/http", "HttpClient");
}

function angularMemberNames(scope: IScope): ReadonlySet<string> {
  const owner = scope.node;
  const clients = new Set<string>();
  if (owner?.type !== "ClassDeclaration" && owner?.type !== "ClassExpression") return clients;
  for (const member of owner.body.body) {
    if (member.type === "ClassProperty" && !member.static && !member.computed &&
      member.key.type === "Identifier" && member.value?.type === "CallExpression" &&
      member.value.arguments.length === 1 &&
      isNamedImport(member.value.callee, scope, "@angular/core", "inject") &&
      isAngularHttpClient(member.value.arguments[0], scope)) {
      clients.add(member.key.name);
    }
    if (member.type !== "ClassMethod" || member.kind !== "constructor") continue;
    for (const param of member.params) {
      if (param.type !== "TSParameterProperty" || param.decorators?.length) continue;
      const { parameter } = param;
      if (parameter.type !== "Identifier" || parameter.decorators?.length) continue;
      const annotation = parameter.typeAnnotation;
      if (annotation?.type !== "TSTypeAnnotation" || annotation.typeAnnotation.type !== "TSTypeReference") continue;
      const { typeName } = annotation.typeAnnotation;
      if (typeName.type === "Identifier" && owner.typeParameters?.type === "TSTypeParameterDeclaration" &&
        owner.typeParameters.params.some(({ name }) => name === typeName.name)) continue;
      if (isAngularHttpClient(typeName, scope)) clients.add(parameter.name);
    }
  }
  return clients;
}

/** Only an instance method and its lexical arrows prove the meaning of `this`. */
function angularInstanceScope(site: ICallSite): IScope | undefined {
  const callStart = site.node.start;
  for (let current: IScope | undefined = site.scope; current; current = current.parent) {
    const node = current.node;
    if (node?.type === "ClassMethod" || node?.type === "ClassPrivateMethod") {
      if (node.static || callStart == null || node.body.start == null || node.body.end == null ||
        callStart < node.body.start || callStart >= node.body.end) return undefined;
      return current.parent;
    }
    if (current.functionBoundary && node?.type !== "ArrowFunctionExpression") return undefined;
  }
  return undefined;
}

function angularMemberCall(
  site: ICallSite,
  cache: Map<IScope, ReadonlySet<string>>,
): { member?: string; callee: string } | undefined {
  const { callee } = site.node;
  if (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") return undefined;
  const receiver = callee.object;
  if ((receiver.type !== "MemberExpression" && receiver.type !== "OptionalMemberExpression") ||
    receiver.object.type !== "ThisExpression") return undefined;

  const scope = angularInstanceScope(site);
  if (!scope) return undefined;
  let clients = cache.get(scope);
  if (!clients) {
    clients = angularMemberNames(scope);
    cache.set(scope, clients);
  }
  const propertyName = receiver.computed ? staticString(receiver.property, site.scope)
    : receiver.property.type === "Identifier" ? receiver.property.name : undefined;
  if (propertyName === undefined || !clients.has(propertyName)) return undefined;
  const member = callee.computed ? staticString(callee.property, site.scope)
    : callee.property.type === "Identifier" ? callee.property.name : undefined;
  return { member, callee: member === undefined ? `this.${propertyName}` : `this.${propertyName}.${member}` };
}

function collectAngularTemplates(
  scopes: readonly IScope[],
  collect: (owner: IAngularClientTemplateOwner) => void,
): void {
  for (const scope of scopes) {
    const node = scope.node;
    if (node?.type !== "ClassDeclaration" && node?.type !== "ClassExpression") continue;
    for (const decorator of node.decorators ?? []) {
      const expression = decorator.expression;
      if (expression.type !== "CallExpression" || expression.arguments.length !== 1 ||
        !isNamedImport(expression.callee, scope, "@angular/core", "Component")) continue;
      const [metadata] = expression.arguments;
      if (metadata?.type !== "ObjectExpression") continue;
      const fields = objectFields(metadata, scope);
      const template = fields?.get("templateUrl");
      if (template?.type !== "StringLiteral" || fields?.has("template")) continue;
      collect({ templateUrl: template.value, members: angularMemberNames(scope) });
    }
  }
}

/** HTTP shorthand methods on Angular HttpClient. */
export function isAngularHttpVerb(member: string): boolean {
  return ["get", "post", "put", "patch", "delete", "head", "options"].includes(member);
}

/** Fetch body evidence is limited to a literal JSON string and an explicit static media type. */
function fetchJsonBody(fields: ReadonlyMap<string, Node>, scope: IScope): string | undefined {
  const body = unwrap(fields.get("body"));
  if (body?.type !== "StringLiteral" || body.value.length > 65_536) return undefined;
  const headers = optionsFields(fields.get("headers"), scope);
  if (!headers) return undefined;
  const contentTypes = [...headers].filter(([name]) => name.toLowerCase() === "content-type");
  if (contentTypes.length !== 1) return undefined;
  const value = staticString(contentTypes[0]?.[1], scope)?.trim();
  return /^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/iu.test(value ?? "") ? body.value : undefined;
}

function request(
  site: ICallSite,
  recognizer: IClientUsage["evidence"]["recognizer"],
  member?: string,
  observeJson = false,
): IRequest {
  const [first, second, third] = site.node.arguments;
  const { scope } = site;
  if (first?.type === "SpreadElement") return { reason: "unknown-options" };

  if (recognizer === "fetch") {
    const fields = optionsFields(second, scope);
    if (!fields) return { url: first, reason: "unknown-options" };
    const method = requestMethod(fields.get("method"), scope);
    const mode = fields.get("mode");
    const jsonBody = observeJson && method && ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method) &&
      (!mode || ["cors", "same-origin"].includes(staticString(mode, scope) ?? ""))
      ? fetchJsonBody(fields, scope)
      : undefined;
    return { url: first, method, jsonBody, reason: method ? undefined : "dynamic-method" };
  }

  const verb = member?.toUpperCase();
  if (recognizer === "angular-http-client") {
    if (member === "request") {
      if (second === undefined) return { reason: "unsupported-call" };
      if (second.type === "SpreadElement") return { reason: "unknown-options" };
      const method = requestMethod(first, scope);
      return { url: second, method, reason: method ? undefined : "dynamic-method" };
    }
    if (member !== undefined && isAngularHttpVerb(member)) {
      return { url: first, method: verb };
    }
    return { reason: "unsupported-call" };
  }
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
  angularClasses?: Map<IScope, ReadonlySet<string>>,
): { recognizer: IClientUsage["evidence"]["recognizer"]; callee: string; member?: string; reason?: ClientUnresolvedReason } | undefined {
  const { node, scope } = site;
  const callee = node.callee;
  const ir = members.get(node.start ?? -1);
  if (callee.type === "Identifier" && callee.name === "fetch") {
    return { recognizer: "fetch", callee: "fetch",
      reason: bindings(scope, "fetch").length ? "shadowed-client" : undefined };
  }
  const angular = angularClasses && angularMemberCall(site, angularClasses);
  if (angular) {
    return {
      recognizer: "angular-http-client",
      ...angular,
      reason: angular.member === undefined ? "unsupported-call" : undefined,
    };
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

function scanProgram(
  program: Program,
  file: string,
  options: IClientConsumptionOptions,
  collectTemplate?: (owner: IAngularClientTemplateOwner) => void,
): IClientUsage[] {
  const members = new Map(collectMethodCallsFromProgram(program, file).map((call) => [call.range.start, call]));
  const templateScopes: IScope[] | undefined = collectTemplate && program.body.some((node) =>
    node.type === "ImportDeclaration" && node.source.value === "@angular/core")
    ? []
    : undefined;
  const { sites, axiosNames } = callSites(program, templateScopes);
  if (templateScopes && collectTemplate) collectAngularTemplates(templateScopes, collectTemplate);
  const usages: IClientUsage[] = [];
  const angularClasses = program.body.some((node) =>
    node.type === "ImportDeclaration" && node.source.value === "@angular/common/http")
    ? new Map<IScope, ReadonlySet<string>>()
    : undefined;
  for (const site of sites) {
    const found = recognize(site, members, axiosNames, options.aliases, angularClasses);
    const { start, end, loc } = site.node;
    if (!found || !loc) continue;
    const observed = found.reason ? { reason: found.reason }
      : request(site, found.recognizer, found.member, options.observeJsonRequest !== undefined);
    const url = staticString(observed.url, site.scope);
    const unresolvedReason = observed.reason ?? (url === undefined ? "dynamic-url" : undefined);
    const staticUrl = url === undefined ? undefined : unwrap(observed.url)?.type === "StringLiteral" ? "literal" : "expression";
    const location = { file, line: loc.start.line, column: loc.start.column, start: start ?? undefined, end: end ?? undefined };
    if (!unresolvedReason && observed.jsonBody !== undefined) options.observeJsonRequest?.(location, observed.jsonBody);
    usages.push({
      location,
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
export function scanClientAst(
  ast: unknown,
  file: string,
  options: IClientConsumptionOptions,
  collectTemplate?: (owner: IAngularClientTemplateOwner) => void,
): IClientUsage[] {
  const parsed = ast as ICachedProgram;
  if (parsed.errors?.length) throw new SyntaxError("Client source did not parse cleanly");
  return scanProgram(parsed.program, file, options, collectTemplate);
}

/** Fallback for syntax that the current shared AST cache cannot parse, including decorators. */
export function scanClientSource(
  source: string,
  file: string,
  options: IClientConsumptionOptions,
  collectTemplate?: (owner: IAngularClientTemplateOwner) => void,
): IClientUsage[] {
  return scanProgram(parseWithProgram(source, file).program as Program, file, options, collectTemplate);
}
