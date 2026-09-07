/**
 * TypeScript frontend barrel.
 *
 * Scanners import from here:
 *
 *   import { parse } from "../../core/language-frontends/typescript";
 *
 * instead of pointing at `parser.ts` directly. If we ever need to also
 * expose `parseAst` (a variant that consumes an already-built Babel
 * AST, useful for adapter tests), it is added to the barrel without
 * touching call sites.
 *
 * (a00010 S7 — TypeScript AST slice)
 */

export {
  parse,
  parseModule,
  parseModuleWithProgram,
  parseWithProgram,
} from "./typescript.parser.js";

import { buildLanguageIRFromProgram } from "../../../frameworks/typescript/build-language-ir.helper.js";
import { propagateConstants } from "../../../frameworks/typescript/constant-propagation.helper.js";
import type { IImportBinding } from "../../../contracts/interfaces/core/language-ir.interface.js";
import { extractExpressRoutesFromIR } from "./extract-routes-express.helper.js";
import {
  extractFastifyRoutesFromIR,
  type IExtractRoutesResult,
  type IExtractedRoute,
  type IRouterMount,
} from "./extract-routes-fastify.helper.js";
import { extractHonoRoutesFromIR } from "./extract-routes-hono.helper.js";
import { parseModuleWithProgram as parseTsModuleWithProgram } from "./typescript.parser.js";

export type SupportedRouteFramework = "express" | "fastify" | "hono";

export type {
  IExtractRoutesResult,
  IExtractedRoute,
  IRouterMount,
};

export function extractRoutes(
  source: string,
  filename: string,
  framework: SupportedRouteFramework,
  options?: {
    readonly program?: unknown;
  },
): IExtractRoutesResult {
  const parsed = options?.program
    ? { program: options.program }
    : parseTsModuleWithProgram(source, filename);
  if (!parsed) return { routes: [], mounts: [] };

  const ir = buildLanguageIRFromProgram(parsed.program, filename);
  const aliases = withFrameworkReceivers(parsed.program, ir.aliases);
  const propagated = propagateConstants(ir.calls, ir.bindings);

  switch (framework) {
    case "express":
      return extractExpressRoutesFromIR(propagated);
    case "fastify":
      return extractFastifyRoutesFromIR(propagated, aliases, filename);
    case "hono":
      return extractHonoRoutesFromIR(propagated, aliases, filename);
  }
}

interface BabelNodeLite {
  readonly type: string;
  readonly start?: number | null;
  readonly end?: number | null;
  readonly [key: string]: unknown;
}

function asNode(value: unknown): BabelNodeLite {
  return value as BabelNodeLite;
}

function withFrameworkReceivers(
  program: unknown,
  aliases: ReadonlyArray<IImportBinding>,
): IImportBinding[] {
  const out = [...aliases];
  const known = new Set(aliases.map((alias) => alias.name));
  const instantiators = new Set(
    aliases
      .filter((alias) => /fastify|hono/.test(alias.source ?? ""))
      .map((alias) => alias.name),
  );
  if (instantiators.size === 0) return out;

  const stack = [asNode(program)];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "VariableDeclarator") {
      const id = asNode(node["id"]);
      const init = asNode(node["init"]);
      const localName = typeof id["name"] === "string" ? (id["name"] as string) : "";
      const callee =
        init.type === "CallExpression" || init.type === "NewExpression"
          ? asNode(init["callee"])
          : null;
      const calleeName = typeof callee?.["name"] === "string" ? (callee["name"] as string) : "";
      if (localName && calleeName && instantiators.has(calleeName) && !known.has(localName)) {
        out.push({
          name: localName,
          importedName: "default",
          source: aliases.find((alias) => alias.name === calleeName)?.source ?? "",
          range: {
            file: typeof node["start"] === "number" || typeof node["end"] === "number"
              ? (aliases.find((alias) => alias.name === calleeName)?.range.file ?? "")
              : filenameOf(aliases),
            start: typeof node["start"] === "number" ? node["start"] : 0,
            end: typeof node["end"] === "number" ? node["end"] : 0,
          },
        });
        known.add(localName);
      }
    }
    for (const child of collectChildren(node)) stack.push(child);
  }
  return out;
}

function filenameOf(aliases: ReadonlyArray<IImportBinding>): string {
  return aliases[0]?.range.file ?? "";
}

function collectChildren(node: BabelNodeLite): ReadonlyArray<BabelNodeLite> {
  const out: BabelNodeLite[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "type" in item) {
          out.push(asNode(item));
        }
      }
      continue;
    }
    if (value && typeof value === "object" && "type" in value) {
      out.push(asNode(value));
    }
  }
  return out;
}

export type {
  TSAssignment,
  TSClass,
  TSClassMethod,
  TSDecorator,
  TSFile,
  TSImport,
  TSImportBinding,
  TSSymbol,
  TSSymbolKind,
  TSMethodCall,
} from "../../../contracts/interfaces/core/language/typescript-frontend.interface.js";

export type {
  TSLiteral,
  TSLiteralBodyRange,
  TSLiteralKind,
} from "../../../contracts/interfaces/core/language/typescript-frontend-literal.interface.js";