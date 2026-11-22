import { readFile } from "node:fs/promises";
import type {
  IClientBackendOperation,
  IClientConsumptionOptions,
  IClientConsumptionResult,
  IClientUsage,
} from "../../contracts/interfaces/core/client-consumption.interface.js";
import { isAstCapable } from "../index/ast-cache.service.js";
import type { ProjectIndex } from "../index/project-index.service.js";
import { scanClientAst, scanClientSource } from "../language-frontends/typescript/client-consumption.helper.js";

function normalizedUrl(raw: string): { path: string; host?: string } | undefined {
  if (raw.trim() !== raw || !raw || /[\\\u0000-\u0020\u007f]/u.test(raw)) return undefined;
  const absolute = /^[a-z][a-z0-9+.-]*:/iu.test(raw);
  const authority = absolute || raw.startsWith("//");
  if (!authority && !raw.startsWith("/")) return undefined;
  try {
    const url = new URL(raw, "http://tanit.invalid/");
    if (!["http:", "https:"].includes(url.protocol) || (absolute && !/^https?:\/\//iu.test(raw))) {
      return undefined;
    }
    return { path: url.pathname, ...(authority ? { host: url.host } : {}) };
  } catch {
    return undefined;
  }
}

function normalizeUsage(usage: IClientUsage): IClientUsage {
  const { url } = usage;
  if (url === undefined || (usage.unresolvedReason === "unknown-options" &&
    usage.evidence.recognizer === "axios")) return usage;
  const target = normalizedUrl(url);
  if (target) return { ...usage, ...target };
  const pathRelative = url !== "" && !url.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/iu.test(url);
  return {
    ...usage,
    confidence: "low",
    unresolvedReason: usage.unresolvedReason ?? (pathRelative ? "relative-url" : "invalid-url"),
  };
}

function correlate(usages: readonly IClientUsage[], backend: readonly IClientBackendOperation[]) {
  const key = (method: string, path: string) => `${method.toUpperCase()} ${path}`;
  const catalog = new Map<string, Array<{ operation: IClientBackendOperation; index: number; host?: string }>>();
  for (const [index, operation] of backend.entries()) {
    const target = normalizedUrl(operation.uri);
    if (!target) continue;
    const id = key(operation.method, target.path);
    const operations = catalog.get(id) ?? [];
    operations.push({ operation, index, host: target.host });
    catalog.set(id, operations);
  }
  const consumed = new Set<number>();
  const paired = usages.map((usage): IClientUsage => {
    if (usage.unresolvedReason || !usage.method || !usage.path) {
      return { ...usage, correlation: { status: "unknown", candidates: [] } };
    }
    const matches = (catalog.get(key(usage.method, usage.path)) ?? []).filter(({ host }) =>
      host === undefined || usage.host === undefined || host === usage.host);
    const [match] = matches;
    if (matches.length === 1 && match) consumed.add(match.index);
    return { ...usage, correlation: {
      status: matches.length === 0 ? "missing" : matches.length === 1 ? "matched" : "ambiguous",
      candidates: matches.map(({ operation }) => operation),
    } };
  });
  return { usages: paired, operationsWithoutConfirmedConsumer: backend.filter((_, index) => !consumed.has(index)) };
}

/** Static JS/TS and Vue script discovery over the caller's existing file inventory and AST cache. */
export async function scanClientConsumption(
  index: Pick<ProjectIndex, "files" | "ensureAst">,
  options: IClientConsumptionOptions = {},
): Promise<IClientConsumptionResult> {
  const usages: IClientUsage[] = [];
  const diagnostics: Array<IClientConsumptionResult["diagnostics"][number]> = [];
  const files = [...index.files()].sort((left, right) => left.relPath.localeCompare(right.relPath));
  for (const file of files) {
    if (/\.component\.html$/iu.test(file.relPath)) {
      diagnostics.push({ file: file.relPath, reason: "unsupported-template" });
      continue;
    }
    const isVue = /\.vue$/iu.test(file.relPath);
    if (!isVue && (!isAstCapable(file.language) || /\.d\.[cm]?ts$/iu.test(file.relPath))) continue;
    try {
      if (isVue) {
        const { scanVueClientSource } = await import("../language-frontends/typescript/vue-client-consumption.parser.js");
        const source = await readFile(file.absPath, "utf8");
        const result = scanVueClientSource(source, file.relPath, options);
        for (const usage of result.usages) usages.push(normalizeUsage(usage));
        diagnostics.push(...result.diagnostics);
        continue;
      }
      const cached = await index.ensureAst(file.relPath);
      const observed = cached
        ? scanClientAst(cached, file.relPath, options)
        : scanClientSource(await readFile(file.absPath, "utf8"), file.relPath, options);
      for (const usage of observed) usages.push(normalizeUsage(usage));
    } catch {
      diagnostics.push({ file: file.relPath, reason: "parse-failed" });
    }
  }
  const result = options.backend === undefined ? { usages } : correlate(usages, options.backend);
  const unresolved = usages.filter((usage) => usage.unresolvedReason !== undefined).length;
  return { ...result, diagnostics, counts: {
    resolved: usages.length - unresolved,
    unresolved,
    matched: result.usages.filter((usage) => usage.correlation?.status === "matched").length,
    missing: result.usages.filter((usage) => usage.correlation?.status === "missing").length,
    ambiguous: result.usages.filter((usage) => usage.correlation?.status === "ambiguous").length,
  } };
}
