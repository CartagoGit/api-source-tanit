import { NodeTypes, parse, type AttributeNode, type ElementNode } from "@vue/compiler-dom";
import type {
  IClientConsumptionOptions,
  IClientConsumptionResult,
  IVueClientScript,
} from "../../../contracts/interfaces/core/client-consumption.interface.js";
import { parseAst } from "../../index/ast-cache.service.js";
import { offsetToPosition } from "../../language-ir/scanner-bridge.helper.js";
import { scanVueClientScripts } from "./client-consumption.helper.js";

function attribute(node: ElementNode, name: string): AttributeNode | undefined {
  return node.props.find((prop): prop is AttributeNode =>
    prop.type === NodeTypes.ATTRIBUTE && prop.name === name);
}

/** Scans inline Vue scripts with evidence mapped to the original component. */
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
  const diagnostics: Array<IClientConsumptionResult["diagnostics"][number]> = templates.length
    ? [{ file, reason: "unsupported-template" }]
    : [];

  const scripts = blocks.filter(({ tag }) => tag === "script");
  const setupCount = scripts.filter((script) => attribute(script, "setup")).length;
  const scriptCount = scripts.length - setupCount;
  if (parseFailed || templates.length > 1 || scriptCount > 1 || setupCount > 1 ||
      (!templates.length && !scripts.length)) {
    diagnostics.push({ file, reason: "parse-failed" });
    return { usages: [], diagnostics };
  }

  const langs = scripts.map((block) => {
    const lang = attribute(block, "lang");
    return lang ? lang.value?.content : "js";
  });
  const [lang] = langs;
  if (scripts.length === 0) return { usages: [], diagnostics };
  if ((lang !== "js" && lang !== "ts" && lang !== "jsx" && lang !== "tsx") ||
      langs.some((value) => value !== lang) ||
      scripts.some((block) => attribute(block, "src")) ||
      (scripts.length > 1 && scripts.some((block) => !block.innerLoc?.source.trim()))) {
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
      const offset = content.start.offset;
      const base = offsetToPosition(source, offset);
      parsed.push({
        ast, setup: attribute(block, "setup") !== undefined,
        mapLocation: ({ line, column, start, end }) => ({
          file,
          line: base.line + line - 1,
          column: line === 1 ? base.column + column : column,
          start: start === undefined ? undefined : offset + start,
          end: end === undefined ? undefined : offset + end,
        }),
      });
    }
    const usages = scanVueClientScripts(parsed, file, options);
    if (!usages) {
      diagnostics.push({ file, reason: "unsupported-script" });
      return { usages: [], diagnostics };
    }
    return { usages, diagnostics };
  } catch {
    diagnostics.push({ file, reason: "parse-failed" });
    return { usages: [], diagnostics };
  }
}
