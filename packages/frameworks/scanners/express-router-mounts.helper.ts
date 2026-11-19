import { isRecord } from "../../core/helpers/parse-json.helper.js";

interface IRouterModule {
  readonly file: string;
  readonly routers: Map<string, string>;
  readonly aliases: Map<string, string>;
  readonly imports: Map<string, { source: string; exported: string }>;
  readonly exports: Map<string, string>;
  readonly mounts: Array<{ parent: string; child: string; prefix: string }>;
}

const nameOf = (node: unknown): string | undefined =>
  isRecord(node) && node.type === "Identifier" && typeof node.name === "string"
    ? node.name : undefined;

const stringOf = (node: unknown): string | undefined =>
  isRecord(node) && node.type === "StringLiteral" && typeof node.value === "string"
    ? node.value : undefined;

/** Read only top-level router wiring; never interpret application code. */
export function collectRouterMounts(
  program: unknown, file: string,
  bindings: readonly { readonly name: string; readonly value: string | number | boolean }[] = [],
): IRouterModule {
  const result: IRouterModule = {
    file, routers: new Map(), aliases: new Map(), imports: new Map(),
    exports: new Map(), mounts: [],
  };
  if (!isRecord(program) || !Array.isArray(program.body)) return result;
  const constants = new Map(bindings.filter((binding) => typeof binding.value === "string").map((binding) => [binding.name, binding.value]));
  const literalString = (node: unknown): string | undefined => {
    const literal = stringOf(node);
    if (literal !== undefined) return literal;
    const constant = constants.get(nameOf(node) ?? "");
    return typeof constant === "string" ? constant : undefined;
  };
  const factories = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of program.body) {
    if (!isRecord(statement) || statement.type !== "ImportDeclaration") continue;
    const source = stringOf(statement.source);
    if (source === undefined || !Array.isArray(statement.specifiers)) continue;
    for (const specifier of statement.specifiers) {
      if (!isRecord(specifier)) continue;
      const local = nameOf(specifier.local);
      const exported = specifier.type === "ImportDefaultSpecifier" ? "default"
        : specifier.type === "ImportNamespaceSpecifier" ? "*" : nameOf(specifier.imported);
      if (local === undefined || exported === undefined) continue;
      result.imports.set(local, { source, exported });
      if (source === "express") {
        if (exported === "Router") factories.add(local);
        if (exported === "default" || exported === "*") namespaces.add(local);
      }
    }
  }

  const evaluate = (value: unknown): string | undefined => {
    const identifier = nameOf(value);
    if (identifier !== undefined) return identifier;
    if (!isRecord(value) || value.type !== "CallExpression") return undefined;
    const callee = value.callee;
    const args = Array.isArray(value.arguments) ? value.arguments : [];
    const factoryName = nameOf(callee);
    const isMember = isRecord(callee) && callee.type === "MemberExpression" && callee.computed === false;
    const property = isMember ? nameOf(callee.property) : undefined;
    const owner = isMember ? nameOf(callee.object) : undefined;
    if ((factoryName !== undefined && (factories.has(factoryName) || namespaces.has(factoryName))) ||
      (property === "Router" && owner !== undefined && namespaces.has(owner))) {
      if (typeof value.start !== "number") return undefined;
      const key = `@${value.start}`;
      let prefix = "";
      const options = args[0];
      if (isRecord(options) && options.type === "ObjectExpression" && Array.isArray(options.properties)) {
        for (const entry of options.properties) {
          if (isRecord(entry) && nameOf(entry.key) === "prefix") prefix = literalString(entry.value) ?? "";
        }
      }
      result.routers.set(key, prefix);
      return key;
    }
    if (!isMember || property === undefined) return undefined;
    // These Express methods return the same receiver. Arbitrary middleware
    // factory calls do not establish router identity.
    if (!["use", "get", "post", "put", "patch", "delete", "head", "options", "trace", "all"].includes(property)) return undefined;
    const parent = evaluate(callee.object);
    if (parent === undefined) return undefined;
    if (property === "use") {
      const prefix = literalString(args[0]);
      for (const argument of args.slice(prefix === undefined ? 0 : 1)) {
        const child = evaluate(argument);
        if (child !== undefined) result.mounts.push({ parent, child, prefix: prefix ?? "" });
      }
    }
    return parent;
  };

  const declarations = (statement: Record<string, unknown>): void => {
    if (!Array.isArray(statement.declarations)) return;
    for (const declaration of statement.declarations) {
      if (!isRecord(declaration)) continue;
      const local = nameOf(declaration.id);
      // CommonJS Express factories still have explicit module provenance.
      const init = declaration.init;
      if (local !== undefined && isRecord(init) && init.type === "CallExpression" &&
        nameOf(init.callee) === "require" && Array.isArray(init.arguments)) {
        const source = stringOf(init.arguments[0]);
        if (source === "express") namespaces.add(local);
        else if (source !== undefined) result.imports.set(local, { source, exported: "default" });
      }
      const router = evaluate(init);
      if (local !== undefined && router !== undefined) result.aliases.set(local, router);
    }
  };
  for (const statement of program.body) {
    if (!isRecord(statement)) continue;
    if (statement.type === "VariableDeclaration") declarations(statement);
    if (statement.type === "ExpressionStatement") {
      const expression = statement.expression;
      evaluate(expression);
      if (isRecord(expression) && expression.type === "AssignmentExpression" && isRecord(expression.left)) {
        const left = expression.left;
        const owner = nameOf(left.object);
        const property = nameOf(left.property);
        const router = evaluate(expression.right);
        if (router !== undefined && owner === "module" && property === "exports") result.exports.set("default", router);
        if (router !== undefined && owner === "exports" && property !== undefined) result.exports.set(property, router);
      }
    }
    if (statement.type === "ExportDefaultDeclaration") {
      const router = evaluate(statement.declaration);
      if (router !== undefined) result.exports.set("default", router);
    }
    if (statement.type === "ExportNamedDeclaration") {
      if (isRecord(statement.declaration)) {
        declarations(statement.declaration);
        if (Array.isArray(statement.declaration.declarations)) {
          for (const declaration of statement.declaration.declarations) {
            if (!isRecord(declaration)) continue;
            const local = nameOf(declaration.id);
            if (local !== undefined) result.exports.set(local, local);
          }
        }
      }
      if (Array.isArray(statement.specifiers)) for (const specifier of statement.specifiers) {
        if (!isRecord(specifier)) continue;
        const local = nameOf(specifier.local);
        const exported = nameOf(specifier.exported);
        if (local !== undefined && exported !== undefined) result.exports.set(exported, local);
      }
    }
  }
  return result;
}

/** Compose mounts by resolved module/instance identity, including default exports. */
export function routerMountPrefixes(
  modules: readonly IRouterModule[],
  resolveModule: (file: string, source: string) => string | undefined,
  onIssue?: (file: string, reason: string) => void,
): (file: string, local: string) => readonly string[] | undefined {
  const byFile = new Map(modules.map((module) => [module.file, module]));
  const keyOf = (file: string, local: string): string => `${file}\0${local}`;
  const resolveRouter = (file: string, local: string, seen = new Set<string>()): string | undefined => {
    const key = keyOf(file, local);
    if (seen.has(key)) return undefined;
    seen.add(key);
    const module = byFile.get(file);
    if (!module) return undefined;
    if (module.routers.has(local)) return key;
    const alias = module.aliases.get(local);
    if (alias !== undefined) return resolveRouter(file, alias, seen);
    const imported = module.imports.get(local);
    if (!imported) return undefined;
    const target = resolveModule(file, imported.source);
    if (target === undefined) return undefined;
    const exported = byFile.get(target)?.exports.get(imported.exported);
    return exported === undefined ? undefined : resolveRouter(target, exported, seen);
  };
  const intrinsic = new Map<string, string>();
  const incoming = new Map<string, Array<{ parent: string; prefix: string }>>();
  for (const module of modules) {
    for (const [local, prefix] of module.routers) intrinsic.set(keyOf(module.file, local), prefix);
    for (const mount of module.mounts) {
      const parent = resolveRouter(module.file, mount.parent);
      const child = resolveRouter(module.file, mount.child);
      if (parent === undefined && child !== undefined) {
        onIssue?.(module.file, "Unresolved Express router mount receiver; its path prefix is unknown.");
      }
      if (parent === undefined || child === undefined) continue;
      const edges = incoming.get(child) ?? [];
      edges.push({ parent, prefix: mount.prefix });
      incoming.set(child, edges);
    }
  }
  const prefixes = (
    key: string, seen: ReadonlySet<string>, budget: { remaining: number; exhausted: boolean },
  ): string[] => {
    if (--budget.remaining < 0 || seen.size >= 256) { budget.exhausted = true; return []; }
    if (seen.has(key)) { onIssue?.(key.split("\0")[0] ?? key, "Cyclic Express router mounts: repeated paths were not expanded indefinitely."); return []; }
    const visited = new Set(seen).add(key);
    const own = intrinsic.get(key) ?? "";
    const mounts = incoming.get(key);
    if (!mounts) return [own];
    return mounts.flatMap((mount) => prefixes(mount.parent, visited, budget).map((prefix) => prefix + mount.prefix + own));
  };
  const cache = new Map<string, readonly string[] | undefined>();
  return (file, local) => {
    const key = resolveRouter(file, local);
    if (key === undefined) return undefined;
    if (cache.has(key)) return cache.get(key);
    const budget = { remaining: 10_000, exhausted: false };
    const values = [...new Set(prefixes(key, new Set(), budget).map((prefix) => prefix.replace(/\/+/g, "/")))];
    if (budget.exhausted) {
      onIssue?.(file, "Too many nested Express router mounts; path prefixes could not be resolved completely.");
      cache.set(key, undefined);
      return undefined;
    }
    const resolved = values.length === 0 ? undefined : values;
    cache.set(key, resolved);
    return resolved;
  };
}
