import { NodeTypes, parse, type AttributeNode, type ElementNode } from "@vue/compiler-dom";
import type {
  IClientConsumptionOptions,
  IClientConsumptionResult,
} from "../../../contracts/interfaces/core/client-consumption.interface.js";
import { parseAst } from "../../index/ast-cache.service.js";
import { offsetToPosition } from "../../language-ir/scanner-bridge.helper.js";
import { scanClientAst } from "./client-consumption.helper.js";

function attribute(node: ElementNode, name: string): AttributeNode | undefined {
  return node.props.find((prop): prop is AttributeNode =>
    prop.type === NodeTypes.ATTRIBUTE && prop.name === name);
}

/** Scans one inline Vue script and maps evidence back to the original component. */
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

  const [block] = scripts;
  if (!block) return { usages: [], diagnostics };
  const langAttr = attribute(block, "lang");
  const lang = langAttr ? langAttr.value?.content : "js";
  if (scripts.length > 1 || attribute(block, "src") ||
      (lang !== "js" && lang !== "ts" && lang !== "jsx" && lang !== "tsx")) {
    diagnostics.push({ file, reason: "unsupported-script" });
    return { usages: [], diagnostics };
  }

  const content = block.innerLoc;
  if (!content) {
    diagnostics.push({ file, reason: "parse-failed" });
    return { usages: [], diagnostics };
  }
  const language = lang === "js" ? "javascript" : lang === "ts" ? "typescript" : lang;
  const ast = parseAst({ source: content.source, language, relPath: `${file}.${lang}` });
  if (!ast) {
    diagnostics.push({ file, reason: "parse-failed" });
    return { usages: [], diagnostics };
  }

  const offset = content.start.offset;
  const base = offsetToPosition(source, offset);
  try {
    const usages = scanClientAst(ast, file, options).map((usage) => {
      const { line, column, start, end } = usage.location;
      return { ...usage, location: {
        file,
        line: base.line + line - 1,
        column: line === 1 ? base.column + column : column,
        start: start === undefined ? undefined : offset + start,
        end: end === undefined ? undefined : offset + end,
      } };
    });
    return { usages, diagnostics };
  } catch {
    diagnostics.push({ file, reason: "parse-failed" });
    return { usages: [], diagnostics };
  }
}
