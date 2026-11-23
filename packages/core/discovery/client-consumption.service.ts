import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type {
  IClientConsumptionOptions,
  IClientConsumptionResult,
  IClientUsage,
} from "../../contracts/interfaces/core/client-consumption.interface.js";
import { ensureInside } from "../helpers/path-containment.helper.js";
import { isAstCapable } from "../index/ast-cache.service.js";
import { toPosix } from "../index/file-cache.service.js";
import type { ProjectIndex } from "../index/project-index.service.js";
import { scanClientAst, scanClientSource, type IAngularClientTemplateOwner } from "../language-frontends/typescript/client-consumption.helper.js";
import { correlateClientUsages, normalizeClientUrl } from "./client-correlation.helper.js";

function normalizeUsage(usage: IClientUsage): IClientUsage {
  const { url } = usage;
  if (url === undefined || (usage.unresolvedReason === "unknown-options" &&
    usage.evidence.recognizer === "axios")) return usage;
  const target = normalizeClientUrl(url);
  if (target) return { ...usage, ...target };
  const pathRelative = url !== "" && !url.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/iu.test(url);
  return {
    ...usage,
    confidence: "low",
    unresolvedReason: usage.unresolvedReason ?? (pathRelative ? "relative-url" : "invalid-url"),
  };
}

function angularTemplatePath(componentFile: string, templateUrl: string): string | undefined {
  if (isAbsolute(templateUrl) || /[:?#\\]/u.test(templateUrl) || !/\.html$/iu.test(templateUrl)) return undefined;
  const path = toPosix(join(dirname(componentFile), templateUrl));
  return path.startsWith("../") ? undefined : path;
}

/** Static JS/TS, Vue and Angular client discovery over the caller's existing file inventory and AST cache. */
export async function scanClientConsumption(
  index: Pick<ProjectIndex, "files" | "ensureAst" | "root">,
  options: IClientConsumptionOptions = {},
): Promise<IClientConsumptionResult> {
  const usages: IClientUsage[] = [];
  const diagnostics: Array<IClientConsumptionResult["diagnostics"][number]> = [];
  const files = [...index.files()].sort((left, right) => left.relPath.localeCompare(right.relPath));
  const owners = new Map<string, Array<IAngularClientTemplateOwner & { componentFile: string }>>();
  for (const file of files) {
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
      const collectTemplate = (owner: IAngularClientTemplateOwner): void => {
        const path = angularTemplatePath(file.relPath, owner.templateUrl);
        if (path === undefined) return;
        const existing = owners.get(path) ?? [];
        existing.push({ ...owner, componentFile: file.absPath });
        owners.set(path, existing);
      };
      const cached = await index.ensureAst(file.relPath);
      const observed = cached
        ? scanClientAst(cached, file.relPath, options, collectTemplate)
        : scanClientSource(await readFile(file.absPath, "utf8"), file.relPath, options, collectTemplate);
      for (const usage of observed) usages.push(normalizeUsage(usage));
    } catch {
      diagnostics.push({ file: file.relPath, reason: "parse-failed" });
    }
  }
  const angularFiles = files.filter(({ relPath }) => /\.component\.html$/iu.test(relPath) || owners.has(relPath));
  for (const file of angularFiles) {
    const candidates = owners.get(file.relPath) ?? [];
    const [owner] = candidates;
    if (candidates.length !== 1 || !owner?.members.size) {
      diagnostics.push({ file: file.relPath, reason: "unsupported-template" });
      continue;
    }
    try {
      const [component, template] = await Promise.all([
        ensureInside(index.root, owner.componentFile),
        ensureInside(index.root, file.absPath),
      ]);
      if (!component.ok || !template.ok) {
        diagnostics.push({ file: file.relPath, reason: "unsupported-template" });
        continue;
      }
      const { scanAngularClientTemplate } = await import("../language-frontends/typescript/angular-client-template.parser.js");
      const source = await readFile(template.resolved, "utf8");
      const result = scanAngularClientTemplate(source, file.relPath, owner.members);
      usages.push(...result.usages.map(normalizeUsage));
      diagnostics.push(...result.diagnostics);
    } catch {
      diagnostics.push({ file: file.relPath, reason: "parse-failed" });
    }
  }
  if (angularFiles.length > 0) {
    usages.sort((left, right) => left.location.file.localeCompare(right.location.file));
    diagnostics.sort((left, right) => left.file.localeCompare(right.file));
  }
  const result = options.backend === undefined ? { usages } : correlateClientUsages(usages, options.backend);
  const unresolved = usages.filter((usage) => usage.unresolvedReason !== undefined).length;
  return { ...result, diagnostics, counts: {
    resolved: usages.length - unresolved,
    unresolved,
    matched: result.usages.filter((usage) => usage.correlation?.status === "matched").length,
    missing: result.usages.filter((usage) => usage.correlation?.status === "missing").length,
    ambiguous: result.usages.filter((usage) => usage.correlation?.status === "ambiguous").length,
  } };
}
