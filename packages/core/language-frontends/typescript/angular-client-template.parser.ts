import {
  ASTWithSource,
  Call,
  LiteralPrimitive,
  ParsedEventType,
  PropertyRead,
  ThisReceiver,
  TmplAstElement,
  TmplAstTemplate,
  TmplAstText,
  parseTemplate,
  type TmplAstBoundEvent,
  type TmplAstNode,
} from "@angular/compiler";
import type {
  IClientConsumptionResult,
  IClientUsage,
} from "../../../contracts/interfaces/core/client-consumption.interface.js";
import { offsetToPosition } from "../../language-ir/scanner-bridge.helper.js";
import { isAngularHttpVerb } from "./client-consumption.helper.js";

function directEventCall(
  source: string,
  file: string,
  event: TmplAstBoundEvent,
  members: ReadonlySet<string>,
): IClientUsage | undefined {
  if (event.type !== ParsedEventType.Regular || !(event.handler instanceof ASTWithSource)) return undefined;
  const { ast: call, source: expression } = event.handler;
  if (!(call instanceof Call) || !(call.receiver instanceof PropertyRead)) return undefined;
  const { name: verb, receiver } = call.receiver;
  if (!(receiver instanceof PropertyRead) || !(receiver.receiver instanceof ThisReceiver) ||
      !members.has(receiver.name) || !isAngularHttpVerb(verb)) return undefined;

  // Angular parses decoded attribute values, and absolute expression offsets
  // may also skip leading whitespace twice. Use the verified raw value and
  // the expression-relative span, which includes that whitespace exactly once.
  const attributeEnd = event.sourceSpan.end.offset;
  const attributeValue = source.slice(event.keySpan.end.offset, attributeEnd);
  const raw = /=\s*(["'])([\s\S]*)\1$/u.exec(attributeValue)?.[2];
  if (raw === undefined || raw !== expression) return undefined;
  const base = attributeEnd - raw.length - 1;
  const leading = call.span.start;
  const endOffset = leading + raw.slice(leading, call.span.end).trimEnd().length;
  if (leading < 0 || endOffset <= leading || call.span.end > raw.length ||
      raw[endOffset - 1] !== ")") return undefined;
  const start = base + leading;
  const end = base + endOffset;
  const argument = call.args[0];
  const url = argument instanceof LiteralPrimitive && typeof argument.value === "string" ? argument.value : undefined;

  return {
    method: verb.toUpperCase(),
    url,
    location: { file, ...offsetToPosition(source, start), start, end },
    evidence: {
      recognizer: "angular-http-client",
      callee: `this.${receiver.name}.${verb}`,
      staticUrl: url === undefined ? undefined : "literal",
    },
    confidence: url === undefined ? "low" : "high",
    unresolvedReason: url === undefined ? "dynamic-url" : undefined,
  };
}

/** Observe conservative external-template calls on component members verified by the caller. */
export function scanAngularClientTemplate(
  source: string,
  file: string,
  members: ReadonlySet<string>,
): Pick<IClientConsumptionResult, "usages" | "diagnostics"> {
  const parsed = parseTemplate(source, file, { preserveLineEndings: true });
  if (parsed.errors?.length) return { usages: [], diagnostics: [{ file, reason: "parse-failed" }] };
  const usages: IClientUsage[] = [];
  let partial = false;

  function walk(nodes: readonly TmplAstNode[]): void {
    for (const node of nodes) {
      if (node instanceof TmplAstText) continue;
      if (!(node instanceof TmplAstElement || node instanceof TmplAstTemplate)) {
        partial = true;
        continue;
      }

      if (node.inputs.length || node.directives.length ||
          (node instanceof TmplAstTemplate && node.templateAttrs.length)) partial = true;
      for (const event of node.outputs) {
        const usage = directEventCall(source, file, event, members);
        if (usage) usages.push(usage);
        else partial = true;
      }
      walk(node.children);
    }
  }

  walk(parsed.nodes);
  usages.sort((left, right) => (left.location.start ?? 0) - (right.location.start ?? 0));
  return { usages, diagnostics: partial ? [{ file, reason: "unsupported-template" }] : [] };
}
