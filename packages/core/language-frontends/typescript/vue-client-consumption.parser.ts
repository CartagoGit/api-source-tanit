import { NodeTypes, parse, type AttributeNode, type ElementNode, type TemplateChildNode } from "@vue/compiler-dom";
import type {
  IClientConsumptionOptions,
  IClientConsumptionResult,
  IVueClientScript,
} from "../../../contracts/interfaces/core/client-consumption.interface.js";
import type { AstCapableLanguage } from "../../../contracts/interfaces/core/index.interface.js";
import { parseAst } from "../../index/ast-cache.service.js";
import { offsetToPosition } from "../../language-ir/scanner-bridge.helper.js";
import { scanVueClientScripts } from "./client-consumption.helper.js";

function attribute(node: ElementNode, name: string): AttributeNode | undefined {
  return node.props.find((prop): prop is AttributeNode =>
    prop.type === NodeTypes.ATTRIBUTE && prop.name === name);
}

function sourceMapper(source: string, file: string, offset: number): IVueClientScript["mapLocation"] {
  const base = offsetToPosition(source, offset);
  return ({ line, column, start, end }) => ({
    file,
    line: base.line + line - 1,
    column: line === 1 ? base.column + column : column,
    start: start === undefined ? undefined : offset + start,
    end: end === undefined ? undefined : offset + end,
  });
}

function readTemplateEvents(
  template: ElementNode | undefined,
  source: string,
  file: string,
  language: AstCapableLanguage,
  extension: string,
): { events: Omit<IVueClientScript, "setup">[]; partial: boolean } {
  const events: Omit<IVueClientScript, "setup">[] = [];
  if (template === undefined) return { events, partial: false };
  if (attribute(template, "src") || attribute(template, "lang")) return { events, partial: true };

  let partial = false;
  function walk(node: TemplateChildNode): void {
    if (node.type === NodeTypes.TEXT || node.type === NodeTypes.COMMENT) return;
    if (node.type !== NodeTypes.ELEMENT || node.props.some((prop) => prop.type === NodeTypes.DIRECTIVE
      ? ["for", "slot", "pre"].includes(prop.name)
      : prop.name === "slot-scope" || prop.name === "scope" || prop.name === "v-pre")) {
      partial = true;
      return;
    }
    for (const prop of node.props) {
      if (prop.type !== NodeTypes.DIRECTIVE) continue;
      const { arg, exp } = prop;
      if (prop.name !== "on" || arg?.type !== NodeTypes.SIMPLE_EXPRESSION || !arg.isStatic ||
          exp?.type !== NodeTypes.SIMPLE_EXPRESSION || exp.loc.source !== exp.content) {
        partial = true;
        continue;
      }
      const start = exp.loc.start.offset;
      if (source.slice(start, exp.loc.end.offset) !== exp.content) {
        partial = true;
        continue;
      }
      const ast = parseAst({ source: exp.content, language, relPath: `${file}.${extension}` });
      if (ast) events.push({ ast, mapLocation: sourceMapper(source, file, start) });
      else partial = true;
    }
    for (const child of node.children) walk(child);
  }
  for (const child of template.children) walk(child);
  return { events, partial };
}

/** Scans Vue scripts and proven inline event calls with original component locations. */
export function scanVueClientSource(
  source: string,
  file: string,
  options: IClientConsumptionOptions,
): Pick<IClientConsumptionResult, "usages" | "diagnostics"> {
  let parseFailed = false;
  const { children } = parse(source, {
    parseMode: "sfc",
    prefixIdentifiers: true,
    onError: () => { parseFailed = true; },
  });
  const blocks = children.filter((child) => child.type === NodeTypes.ELEMENT);
  const templates = blocks.filter(({ tag }) => tag === "template");
  const diagnostics: Array<IClientConsumptionResult["diagnostics"][number]> = [];
  function unsupportedTemplate(): void {
    if (templates.length > 0) diagnostics.push({ file, reason: "unsupported-template" });
  }

  const scripts = blocks.filter(({ tag }) => tag === "script");
  const setupCount = scripts.filter((script) => attribute(script, "setup")).length;
  const scriptCount = scripts.length - setupCount;
  if (parseFailed || templates.length > 1 || scriptCount > 1 || setupCount > 1 ||
      (!templates.length && !scripts.length)) {
    unsupportedTemplate();
    diagnostics.push({ file, reason: "parse-failed" });
    return { usages: [], diagnostics };
  }

  const langs = scripts.map((block) => {
    const lang = attribute(block, "lang");
    return lang ? lang.value?.content : "js";
  });
  const [lang] = langs;
  if (scripts.length === 0) {
    const template = readTemplateEvents(templates[0], source, file, "javascript", "js");
    if (template.partial || template.events.length > 0) unsupportedTemplate();
    return { usages: [], diagnostics };
  }
  if ((lang !== "js" && lang !== "ts" && lang !== "jsx" && lang !== "tsx") ||
      langs.some((value) => value !== lang) ||
      scripts.some((block) => attribute(block, "src")) ||
      (scripts.length > 1 && scripts.some((block) => !block.innerLoc?.source.trim()))) {
    unsupportedTemplate();
    diagnostics.push({ file, reason: "unsupported-script" });
    return { usages: [], diagnostics };
  }

  const language = lang === "js" ? "javascript" : lang === "ts" ? "typescript" : lang;
  const parsed: IVueClientScript[] = [];
  try {
    for (const block of scripts) {
      const content = block.innerLoc;
      if (!content) throw new SyntaxError("Missing Vue script content");
      const ast = parseAst({ source: content.source, language, relPath: `${file}.${lang}` });
      if (!ast) throw new SyntaxError("Invalid Vue script content");
      parsed.push({
        ast, setup: attribute(block, "setup") !== undefined,
        mapLocation: sourceMapper(source, file, content.start.offset),
      });
    }
    const template = readTemplateEvents(templates[0], source, file, language, lang);
    let partial = template.partial;
    const usages = scanVueClientScripts(parsed, file, options, {
      events: template.events,
      onUnsupported: () => { partial = true; },
    });
    if (!usages) {
      unsupportedTemplate();
      diagnostics.push({ file, reason: "unsupported-script" });
      return { usages: [], diagnostics };
    }
    if (partial) unsupportedTemplate();
    return { usages, diagnostics };
  } catch {
    unsupportedTemplate();
    diagnostics.push({ file, reason: "parse-failed" });
    return { usages: [], diagnostics };
  }
}
