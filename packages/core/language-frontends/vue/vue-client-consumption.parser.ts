import { parse } from "@vue/compiler-sfc";
import type {
  IClientConsumptionOptions,
  IClientConsumptionResult,
} from "../../../contracts/interfaces/core/client-consumption.interface.js";
import { parseAst } from "../../index/ast-cache.service.js";
import { offsetToPosition } from "../../language-ir/scanner-bridge.helper.js";
import { scanClientAst } from "../typescript/client-consumption.helper.js";

/** Scans one inline Vue script and maps evidence back to the original component. */
export function scanVueClientSource(
  source: string,
  file: string,
  options: IClientConsumptionOptions,
): Pick<IClientConsumptionResult, "usages" | "diagnostics"> {
  const { descriptor, errors } = parse(source, {
    filename: file,
    sourceMap: false,
    ignoreEmpty: false,
  });
  const { script, scriptSetup, template } = descriptor;
  const diagnostics: Array<IClientConsumptionResult["diagnostics"][number]> = template
    ? [{ file, reason: "unsupported-template" }]
    : [];

  if (errors.length) {
    // Vue drops the block from the descriptor when script setup cannot use src.
    const externalScript = errors.every(({ message }) =>
      message.startsWith('<script setup> cannot use the "src" attribute') ||
      message.startsWith('<script> cannot use the "src" attribute when <script setup>'));
    diagnostics.push({ file, reason: externalScript ? "unsupported-script" : "parse-failed" });
    return { usages: [], diagnostics };
  }

  const block = script ?? scriptSetup;
  if (!block) return { usages: [], diagnostics };
  const lang = block.attrs.lang ?? "js";
  if ((script && scriptSetup) || Object.hasOwn(block.attrs, "src") ||
      (lang !== "js" && lang !== "ts" && lang !== "jsx" && lang !== "tsx")) {
    diagnostics.push({ file, reason: "unsupported-script" });
    return { usages: [], diagnostics };
  }

  const language = lang === "js" ? "javascript" : lang === "ts" ? "typescript" : lang;
  const ast = parseAst({ source: block.content, language, relPath: `${file}.${lang}` });
  if (!ast) {
    diagnostics.push({ file, reason: "parse-failed" });
    return { usages: [], diagnostics };
  }

  const offset = block.loc.start.offset;
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
