/**
 * Barrel del frontend TypeScript.
 *
 * Los scanners importan de aquí:
 *
 *   import { parse } from "../../core/language-frontends/typescript";
 *
 * en vez de apuntar a `parser.ts` directamente. Si mañana hay que
 * exponer también `parseAst` (variante que consume un AST Babel ya
 * construido, útil para tests de adapters), se añade al barrel sin
 * tocar los call sites.
 *
 * (a00010 S7 — slice AST TypeScript)
 */

export { parse, parseModule } from "./typescript.parser.js";

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