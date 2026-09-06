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